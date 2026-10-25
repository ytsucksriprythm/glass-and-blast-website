// Server-side logic for the recurring customer portal (/portal/[token]).
// Login is link token + 4-digit PIN; a wrong PIN PORTAL_MAX_FAILS times in a
// row locks the portal for PORTAL_LOCK_MINUTES (the token alone is already
// unguessable, so the PIN is a second factor, not the only one).
import crypto from 'crypto';
import {
  getRecurringJobs, updateRecurringJob, getBookingsForRecurring, getInvoices, getQuotes, getSettings,
  getBusinessProfiles, addBooking, getBookingById, newPortal, newPortalPin, logActivity,
  type RecurringJob, type CustomerPortal, type PortalRequest, type Booking, type ServiceType,
} from '@/lib/db';
import { getPortalSession } from '@/lib/auth';
import { buildContractTerms, contractSections, contractTitle, contractText, cadenceText, CONTRACT_VERSION, type ContractParty } from '@/lib/contract';
import { BUSINESS_DEFAULTS } from '@/lib/invoice';
import { discountFor } from '@/lib/recurring';

export const PORTAL_MAX_FAILS = 5;
export const PORTAL_LOCK_MINUTES = 15;

const sydneyDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

// Give a profile its portal (link + PIN) if it doesn't have one yet — profiles
// made before the portal existed get theirs the first time admin looks.
export async function ensurePortal(job: RecurringJob): Promise<RecurringJob> {
  if (job.portal) return job;
  return (await updateRecurringJob(job.id, { portal: newPortal() })) ?? job;
}

export async function ensureAllPortals(jobs: RecurringJob[]): Promise<RecurringJob[]> {
  const out: RecurringJob[] = [];
  for (const j of jobs) out.push(j.portal || j.id.startsWith('LARP-') ? j : await ensurePortal(j));
  return out;
}

async function savePortal(job: RecurringJob, portal: CustomerPortal): Promise<RecurringJob> {
  return (await updateRecurringJob(job.id, { portal })) ?? { ...job, portal };
}

// New PIN: also bumps sessionVersion, so anyone already logged in is signed out.
export async function regeneratePin(job: RecurringJob): Promise<RecurringJob> {
  const p = job.portal ?? newPortal();
  return savePortal(job, { ...p, pin: newPortalPin(), sessionVersion: p.sessionVersion + 1, failCount: 0, lockedUntil: null });
}

export async function findByPortalToken(token: string): Promise<RecurringJob | null> {
  if (!/^cp_[0-9a-f]{24}$/.test(token)) return null;
  return (await getRecurringJobs()).find(j => j.portal?.token === token) ?? null;
}

export type LoginResult =
  | { ok: true; job: RecurringJob }
  | { ok: false; error: string; status: number };

export async function tryPortalLogin(token: string, pin: string): Promise<LoginResult> {
  const job = await findByPortalToken(token);
  if (!job?.portal) return { ok: false, error: 'This link isn\'t valid. Ask us for a new one.', status: 404 };
  const p = job.portal;
  if (p.lockedUntil && new Date(p.lockedUntil) > new Date()) {
    return { ok: false, error: `Too many wrong PINs. Try again in ${PORTAL_LOCK_MINUTES} minutes, or ask us for your PIN.`, status: 429 };
  }
  const a = Buffer.from(String(pin ?? ''));
  const b = Buffer.from(p.pin);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    const saved = p.failCount || p.lockedUntil ? await savePortal(job, { ...p, failCount: 0, lockedUntil: null }) : job;
    return { ok: true, job: saved };
  }
  const failCount = p.failCount + 1;
  const locked = failCount >= PORTAL_MAX_FAILS;
  await savePortal(job, {
    ...p,
    failCount: locked ? 0 : failCount,
    lockedUntil: locked ? new Date(Date.now() + PORTAL_LOCK_MINUTES * 60_000).toISOString() : p.lockedUntil,
  });
  return locked
    ? { ok: false, error: `Too many wrong PINs. Try again in ${PORTAL_LOCK_MINUTES} minutes, or ask us for your PIN.`, status: 429 }
    : { ok: false, error: `That PIN isn't right. ${PORTAL_MAX_FAILS - failCount} ${PORTAL_MAX_FAILS - failCount === 1 ? 'try' : 'tries'} left.`, status: 401 };
}

// The profile for this link, only if the request carries a live session for it.
export async function getAuthedProfile(token: string): Promise<RecurringJob | null> {
  const job = await findByPortalToken(token);
  if (!job?.portal) return null;
  const s = await getPortalSession();
  if (!s || s.profileId !== job.id || s.version !== job.portal.sessionVersion) return null;
  return job;
}

async function businessParty(): Promise<ContractParty> {
  const b = (await getBusinessProfiles().catch(() => []))[0] ?? BUSINESS_DEFAULTS;
  return { name: b.fromName, tradingAs: b.fromTradingAs, abn: b.fromAbn, address: b.fromAddress, phone: b.fromPhone, email: b.fromEmail };
}

// The agreement as it would be signed right now (unsigned profiles).
export async function currentContractTerms(job: RecurringJob) {
  return buildContractTerms(job, await getSettings(), await businessParty());
}

export async function signContract(job: RecurringJob, input: { signerName: string; signature: string; ip: string; userAgent: string }): Promise<RecurringJob> {
  if (!job.portal) throw new Error('No portal');
  if (job.portal.contract) return job; // once-off: never re-sign over an existing signature
  const terms = await currentContractTerms(job);
  const termStart = sydneyDate();
  const saved = await savePortal(job, {
    ...job.portal,
    contract: {
      version: CONTRACT_VERSION,
      signedAt: new Date().toISOString(),
      termStart,
      signerName: input.signerName,
      signature: input.signature,
      ip: input.ip,
      userAgent: input.userAgent.slice(0, 300),
      terms,
      text: contractText(terms, termStart),
    },
  });
  void logActivity('recurring.contract_signed', `${job.name} signed their recurring service agreement`, { recurringId: job.id }, 'customer');
  void pushNtfy(`${job.name} signed their contract`, `${terms.cadenceText}${job.discount ? ` · $${job.discount} off per clean` : ''}`, `/admin/recurring/${job.id}`);
  return saved;
}

// ntfy push to the owner's phone (same topic as new-booking alerts).
async function pushNtfy(title: string, body: string, adminPath: string): Promise<void> {
  if (!process.env.NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
      method: 'POST',
      body,
      headers: { Title: title, Tags: 'customer,calendar', Click: `${process.env.NEXT_PUBLIC_URL ?? 'https://glassandblast.com.au'}${adminPath}` },
    });
  } catch (err) { console.error('Push (ntfy) failed:', err); }
}

const fmtDate = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

// "Book a new job": goes in as an uncontacted booking on their profile with
// the date they'd like; we confirm with them and schedule it.
export async function requestNewJob(job: RecurringJob, input: { preferredDate: string; preferredTime: string; note: string }): Promise<PortalRequest> {
  const booking = await addBooking({
    name: job.name, phone: job.phone, email: job.email, address: job.address, suburb: job.suburb,
    service: job.service as ServiceType,
    propertyType: job.propertyType,
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
    notes: input.note,
    quoteAmount: job.visitPrice != null ? job.visitPrice - discountFor(job.visitPrice, job.discount) : null,
    adminNotes: 'Requested by the customer in their portal — confirm the date with them.',
    status: 'uncontacted',
    source: 'manual',
    recurringId: job.id,
  });
  return addRequest(job, { type: 'book', bookingId: booking.id, ...input },
    `${job.name} wants a clean`, `Preferred: ${fmtDate(input.preferredDate)}${input.preferredTime ? ` ${input.preferredTime}` : ''}${input.note ? `\n${input.note}` : ''}`,
    `/admin/bookings/${booking.id}`);
}

export async function requestReschedule(job: RecurringJob, bookingId: string, input: { preferredDate: string; preferredTime: string; note: string }): Promise<PortalRequest | null> {
  const booking = await getBookingById(bookingId);
  if (!booking || booking.recurringId !== job.id) return null;
  const was = booking.scheduledAt ? new Date(booking.scheduledAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'unscheduled';
  return addRequest(job, { type: 'reschedule', bookingId, ...input },
    `${job.name} wants to reschedule`, `Was: ${was}\nWants: ${fmtDate(input.preferredDate)}${input.preferredTime ? ` ${input.preferredTime}` : ''}${input.note ? `\n${input.note}` : ''}`,
    `/admin/recurring/${job.id}`);
}

async function addRequest(job: RecurringJob, r: Omit<PortalRequest, 'id' | 'createdAt' | 'doneAt'>, title: string, body: string, adminPath: string): Promise<PortalRequest> {
  const fresh = (await getRecurringJobs()).find(j => j.id === job.id) ?? job;
  const p = fresh.portal ?? newPortal();
  const req: PortalRequest = { ...r, id: `RQ-${Date.now()}`, createdAt: new Date().toISOString(), doneAt: null };
  await savePortal(fresh, { ...p, requests: [req, ...p.requests].slice(0, 100) });
  void logActivity('recurring.portal_request', `${job.name}: ${title}`, { recurringId: job.id, requestId: req.id }, 'customer');
  await pushNtfy(title, body, adminPath);
  return req;
}

export async function markRequestDone(job: RecurringJob, requestId: string, done: boolean): Promise<RecurringJob | null> {
  if (!job.portal) return null;
  const requests = job.portal.requests.map(r => r.id === requestId ? { ...r, doneAt: done ? new Date().toISOString() : null } : r);
  return savePortal(job, { ...job.portal, requests });
}

// Everything the customer sees — no admin notes, no internal ids beyond what
// they need to act on (booking ids for reschedule, public invoice/quote tokens).
export async function portalView(job: RecurringJob) {
  const bookings = (await getBookingsForRecurring(job.id)).filter(b => b.status !== 'cancelled' && b.status !== 'cold');
  const ids = new Set(bookings.map(b => b.id));
  const now = Date.now();
  const isUpcoming = (b: Booking) => b.status !== 'completed' && (!b.scheduledAt || new Date(b.scheduledAt).getTime() >= now - 12 * 3600_000);
  const toJob = (b: Booking) => ({
    id: b.id,
    scheduledAt: b.scheduledAt ?? null,
    preferredDate: b.preferredDate || null,
    service: b.service,
    status: b.status,
    price: typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? b.quoteAmount : null,
    paid: b.paid,
  });
  const byWhen = (b: Booking) => b.scheduledAt ?? b.preferredDate ?? b.createdAt;
  const upcoming = bookings.filter(isUpcoming).sort((a, b) => byWhen(a).localeCompare(byWhen(b))).map(toJob);
  const past = bookings.filter(b => !isUpcoming(b)).sort((a, b) => byWhen(b).localeCompare(byWhen(a))).slice(0, 20).map(toJob);

  const invoices = (await getInvoices())
    .filter(i => i.status !== 'draft' && i.status !== 'cancelled' && (i.bookingIds ?? []).some(id => ids.has(id)))
    .map(i => ({ number: i.number, total: i.total, status: i.status, date: i.invoiceDate, dueDate: i.dueDate, token: i.token }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const quotes = (await getQuotes())
    .filter(q => q.status === 'sent' && ids.has(q.bookingId))
    .map(q => ({ number: q.number, total: q.amount, date: q.quoteDate, validUntil: q.validUntil, token: q.token }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const signed = job.portal?.contract ?? null;
  const terms = signed ? signed.terms : await currentContractTerms(job);
  return {
    name: job.name,
    firstName: job.name.split(' ')[0],
    plan: { cadenceText: cadenceText(job), discount: job.discount, nextDate: job.nextDate, active: job.active },
    contract: {
      signed: !!signed,
      signedAt: signed?.signedAt ?? null,
      signerName: signed?.signerName ?? null,
      signature: signed?.signature ?? null,
      termStart: signed?.termStart ?? null,
      title: contractTitle(terms),
      sections: contractSections(terms, signed?.termStart),
    },
    upcoming,
    past,
    invoices,
    quotes,
    requests: (job.portal?.requests ?? []).filter(r => !r.doneAt).map(r => ({ id: r.id, type: r.type, bookingId: r.bookingId, preferredDate: r.preferredDate, preferredTime: r.preferredTime, createdAt: r.createdAt })),
  };
}
export type PortalView = Awaited<ReturnType<typeof portalView>>;
