// Write tools for the ChatGPT connector, registered only when
// MCP_WRITES_ENABLED=true (see config.ts). Unlike the read tools these go
// through src/lib/db.ts on the app's normal (owner) connection: the same
// functions the admin uses, so every side effect stays consistent — activity
// log (actor "chatgpt"), quote → booking price sync, Google Sheet "Site Status"
// for Facebook leads, recurring profile links.
//
// Rules: records are addressed by exact id only (never by name); nothing can
// be deleted; every call is rate-limited and audited like the read tools.
// ChatGPT shows a confirmation before calling any tool not marked read-only,
// so by default these are labelled read-only and run without asking; set
// MCP_WRITES_CONFIRM=true to label them as writes and get the prompt back.
// The label only changes ChatGPT's UI — every check below still applies.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { type McpConfig, MCP_SCOPE } from './config';
import type { CallerInfo } from './tools';
import { canUseWriteTool } from './scopes';
import { audit, countEvents, claimRequest, completeRequest, releaseRequest } from './authStore';
import { normalizeDocNumber } from './records';
import { isIsoDate, toSydney, sydneyToday } from './time';
import {
  addBooking, updateBooking, getBookingById, getBookingsInRange, logActivity,
  createQuote, getQuotes, getQuoteById, updateQuote, getSettings,
  createInvoice, getInvoices, getInvoiceById, updateInvoice,
  getRecurringJobs, createProfileFromBooking, createJobForProfile, generateNextVisit,
  type Booking, type BookingStatus, type ServiceType,
} from '@/lib/db';
import { syncBookingStatusToSheet } from '@/lib/metaLeads';
import {
  addDays, DEFAULT_QUOTE_TERMS, DEFAULT_QUOTE_ASSUMPTIONS, DEFAULT_PAYMENT_DUE_TERMS, QUOTE_VALID_DAYS,
  QUOTE_SERVICE_OPTIONS, QUOTE_EXTRA_OPTIONS, resolvePackageFields, packagePercentsFromSettings,
  type QuoteInput, type Quote,
} from '@/lib/quote';
import { BUSINESS_DEFAULTS, PAYMENT_DEFAULTS, paymentDueTermsDays, type InvoiceInput, type Invoice } from '@/lib/invoice';
import { presetDiscount } from '@/lib/recurring';

const writeAnnotations = (confirm: boolean) =>
  ({ readOnlyHint: !confirm, destructiveHint: false, idempotentHint: false, openWorldHint: false }) as const;

// ─── Input schemas ──────────────────────────────────────────────────────────

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid id format');
// Quote/invoice id or number as said aloud: "Q1114", "Q-1114", "Q 1114", "#1114".
const docRef = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.:# -]+$/, 'Invalid quote/invoice id or number');
const date = z.string().refine(isIsoDate, 'Use a real calendar date in YYYY-MM-DD format (Australia/Sydney).');
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use Sydney local time as YYYY-MM-DDTHH:MM, e.g. 2026-11-05T09:30');
const money = z.number().finite().min(-100000).max(100000);
const STATUSES = ['uncontacted', 'contacted', 'quote-booked', 'quoted', 'confirmed', 'completed', 'cancelled', 'cold'] as const;
const SERVICES = ['window-washing', 'pressure-washing', 'flyscreen-repair', 'solar-panel-cleaning', 'other'] as const;
const LEAD_SOURCES = ['called-us', 'we-called', 'door-to-door', 'in-person', 'real-estate', 'other'] as const;
const QUOTE_ITEM_KEYS = [...QUOTE_SERVICE_OPTIONS.map(o => o.key), ...QUOTE_EXTRA_OPTIONS.map(o => o.key)] as [string, ...string[]];

// ─── Helpers ────────────────────────────────────────────────────────────────

// Sydney local wall time → UTC ISO. Tries both possible offsets (AEST +10,
// AEDT +11) and keeps the one that renders back to the same wall time, so a
// time skipped by the daylight-saving change is rejected instead of shifted.
export function sydneyLocalToIso(local: string): string | null {
  const [d, t] = local.split('T');
  if (!isIsoDate(d)) return null;
  const [hh, mm] = t.split(':').map(Number);
  if (hh > 23 || mm > 59) return null;
  for (const off of [11, 10]) {
    const iso = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), hh - off, mm)).toISOString();
    const back = toSydney(iso);
    if (back && back.date === d && back.time === t) return iso;
  }
  return null;
}

const bookingView = (b: Booking) => ({
  ...b,
  scheduledSydney: toSydney(b.scheduledAt ?? null)?.label ?? null,
  adminLink: `/admin/bookings/${b.id}`,
});

// "Q-1114", "q 1114" and "1114" all find Q1114 (speech-to-text adds dashes).
async function findQuote(idOrNumber: string) {
  const number = normalizeDocNumber(idOrNumber, 'Q').toLowerCase();
  return (await getQuoteById(idOrNumber.trim())) ?? (await getQuotes()).find(q => q.number.toLowerCase() === number) ?? null;
}
async function findInvoice(idOrNumber: string): Promise<Invoice | null> {
  const number = normalizeDocNumber(idOrNumber, 'GB').toLowerCase();
  return (await getInvoiceById(idOrNumber.trim())) ?? (await getInvoices()).find(i => i.number.toLowerCase() === number) ?? null;
}

// Same side effect the admin's booking PATCH route has on a status change.
async function afterStatusChange(before: Booking, after: Booking, actor: string) {
  if (after.status === before.status) return;
  await logActivity('booking.status_changed', `${after.name}: ${before.status} -> ${after.status}`, { bookingId: after.id, from: before.status, to: after.status }, actor);
  syncBookingStatusToSheet(after).catch(err => console.error('[mcp] sheet status sync failed:', err instanceof Error ? err.message : err));
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerWriteTools(server: McpServer, cfg: McpConfig, caller: CallerInfo): void {
  const link = (path: string) => `${cfg.baseUrl}${path}`;
  // Who made the change, for the activity log and note stamps: the owner via
  // ChatGPT/Claude, or the Atlas phone assistant (Vapi machine login).
  const isOwner = caller.scopes.includes(MCP_SCOPE);
  const actor = isOwner ? 'chatgpt' : 'atlas';
  const via = isOwner ? 'ChatGPT' : 'Atlas';

  // ── Retry protection ─────────────────────────────────────────────────────
  // create_* tools take an optional requestId. Retrying a timed-out call with
  // the same requestId returns the record the first attempt saved instead of
  // creating a duplicate.
  const requestIdSchema = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'Letters, digits, - _ . : only').optional()
    .describe('Unique id for THIS create (e.g. a UUID). If the call times out or errors, retry with the SAME requestId: you get back the record already created instead of a duplicate. Use a new requestId for a genuinely new record.');

  type Created = { id: string; result: Record<string, unknown> } | { error: string };
  async function once(
    toolName: string, requestId: string | undefined,
    create: () => Promise<Created>,
    fetchExisting: (recordId: string) => Promise<Record<string, unknown> | null>,
  ): Promise<Record<string, unknown>> {
    if (!requestId) {
      const r = await create();
      return 'error' in r ? r : r.result;
    }
    const claim = await claimRequest(caller.clientId, requestId, toolName);
    if (claim.state === 'conflict') return { error: `requestId ${requestId} was already used for ${claim.tool}. Use a new requestId.` };
    if (claim.state === 'pending') return { error: 'The first attempt with this requestId is still saving. Wait a few seconds, then retry with the same requestId.' };
    if (claim.state === 'done') {
      const existing = await fetchExisting(claim.recordId);
      if (!existing) return { error: `The record created by this requestId (${claim.recordId}) can no longer be found.` };
      return { ...existing, duplicateRequest: true, note: 'Already created by an earlier attempt with this requestId — nothing new was created. This is the saved record.' };
    }
    try {
      const r = await create();
      if ('error' in r) { await releaseRequest(caller.clientId, requestId); return r; }
      await completeRequest(caller.clientId, requestId, r.id);
      return r.result;
    } catch (err) {
      await releaseRequest(caller.clientId, requestId);
      throw err;
    }
  }

  // ── Quote → booking (narrower than the admin Quote Maker) ────────────────
  // The admin's createQuote syncs every quote onto its booking: it overwrites
  // the price (even on confirmed/paid jobs) and moves quote-booked bookings
  // to "quoted" (so a booked quote visit stops counting as one). Connector
  // quotes skip that and apply only this:
  //   - draft quotes never touch the booking;
  //   - a SENT quote moves an open lead (uncontacted / contacted, or
  //     quote-booked whose visit is already past) to "quoted" with the quote
  //     total as its price;
  //   - confirmed / completed / cancelled / cold / quoted / paid bookings and
  //     upcoming quote visits are left exactly as they are.
  async function applyQuoteToBooking(quote: Quote): Promise<{ changed: string[]; reason: string }> {
    if (quote.status !== 'sent') return { changed: [], reason: 'Draft quote: the booking is not changed until the quote is marked sent.' };
    const b = await getBookingById(quote.bookingId);
    if (!b || b.deletedAt) return { changed: [], reason: 'Linked booking not found.' };
    const visitAhead = b.status === 'quote-booked' && !!b.scheduledAt && Date.parse(b.scheduledAt) > Date.now();
    const open = b.status === 'uncontacted' || b.status === 'contacted' || (b.status === 'quote-booked' && !visitAhead);
    if (!open || b.paid) {
      return { changed: [], reason: `Booking is "${b.status}"${visitAhead ? ' with its quote visit still ahead' : ''}${b.paid ? ' and paid' : ''}: its status and price were left unchanged.` };
    }
    const after = await updateBooking(b.id, { status: 'quoted', quoteAmount: quote.amount });
    if (after) await afterStatusChange(b, after, actor);
    return { changed: ['status', 'quoteAmount'], reason: `Sent quote on an open lead: booking moved ${b.status} -> quoted, price set to $${quote.amount}.` };
  }

  function tool<S extends z.ZodRawShape>(
    name: string, title: string, description: string, inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    // Owner tokens: every write tool (MCP_WRITES_ENABLED). Vapi tokens: only
    // the ones their scopes allow (quotes.write → create/update quote).
    if (!canUseWriteTool(caller.scopes, name, cfg.writesEnabled)) return;
    server.registerTool(name, { title, description, inputSchema, annotations: { title, ...writeAnnotations(cfg.writesConfirm) } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any): Promise<CallToolResult> => {
        const started = Date.now();
        const base = { clientId: caller.clientId, tokenId: caller.tokenId, ip: caller.ip, tool: name };
        try {
          const recent = await countEvents('tool_call', 600, { clientId: caller.clientId });
          if (recent >= cfg.toolCallsPer10Min) {
            await audit({ ...base, event: 'rate_limited', ok: false });
            return { content: [{ type: 'text', text: `Rate limit reached (${cfg.toolCallsPer10Min} tool calls per 10 minutes). Wait a few minutes and continue.` }], isError: true };
          }
          const result = await handler(args) as Record<string, unknown>;
          const failed = !!result && typeof result === 'object' && 'error' in result;
          // Field names only — values (names, phones, notes) never go in the audit log.
          await audit({ ...base, event: 'tool_call', ok: !failed, detail: { write: true, fields: Object.keys(args ?? {}) }, resultCount: failed ? 0 : 1, durationMs: Date.now() - started });
          if (failed) return { content: [{ type: 'text', text: String(result.error) }], isError: true };
          return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
        } catch (err) {
          await audit({ ...base, event: 'tool_call', ok: false, detail: { write: true, error: 'internal' }, durationMs: Date.now() - started });
          console.error(`[mcp] ${name} failed:`, err instanceof Error ? err.message : 'unknown error');
          return { content: [{ type: 'text', text: 'Something went wrong saving that. Nothing may have changed — check with get_booking / get_quote / get_invoice before retrying.' }], isError: true };
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
  }

  // ── Bookings ─────────────────────────────────────────────────────────────

  tool('create_booking', 'Add a booking (customer / lead / job)',
    'Adds a new booking, exactly like "Add booking" in the admin. Use for a new customer, lead or job. Optionally put it straight on the calendar with scheduledStart (Sydney local time). Check search_everything first so you don\'t create a duplicate of an existing customer.',
    {
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional(), email: z.string().trim().max(200).optional(),
      address: z.string().trim().max(300).optional(), suburb: z.string().trim().max(100).optional(),
      services: z.array(z.enum(SERVICES)).max(5).optional().describe('Default: window-washing'),
      propertyType: z.enum(['residential', 'commercial']).optional(),
      status: z.enum(STATUSES).optional().describe('Default uncontacted'),
      quoteAmount: money.optional().describe('Price in AUD'),
      preferredDate: date.optional(), preferredTime: z.string().max(40).optional(),
      notes: z.string().max(4000).optional().describe('Customer-visible notes'),
      adminNotes: z.string().max(4000).optional().describe('Private notes'),
      leadSource: z.enum(LEAD_SOURCES).optional(),
      scheduledStart: localDateTime.optional().describe('Put on the calendar at this Sydney local time'),
      durationMinutes: z.number().int().min(15).max(720).optional().describe('Calendar slot length, default 120'),
      requestId: requestIdSchema,
    },
    async a => {
      let scheduledAt: string | null = null;
      let scheduledEnd: string | null = null;
      if (a.scheduledStart) {
        scheduledAt = sydneyLocalToIso(a.scheduledStart);
        if (!scheduledAt) return { error: `${a.scheduledStart} isn't a valid Sydney time (it may fall in the daylight-saving gap).` };
        scheduledEnd = new Date(Date.parse(scheduledAt) + (a.durationMinutes ?? 120) * 60_000).toISOString();
      }
      const fetchBooking = async (bookingId: string) => {
        const b = await getBookingById(bookingId);
        return b ? { created: true, booking: bookingView(b) } : null;
      };
      return once('create_booking', a.requestId, async () => {
      const booking = await addBooking({
        name: a.name, phone: a.phone ?? '', email: a.email ?? '', address: a.address ?? '', suburb: a.suburb ?? '',
        service: (a.services?.length ? a.services.join(',') : 'window-washing') as ServiceType,
        propertyType: a.propertyType ?? 'residential',
        preferredDate: a.preferredDate ?? '', preferredTime: a.preferredTime ?? '',
        notes: a.notes ?? '', adminNotes: a.adminNotes ?? '',
        quoteAmount: a.quoteAmount ?? null,
        status: (a.status ?? (scheduledAt ? 'confirmed' : 'uncontacted')) as BookingStatus,
        source: 'manual', scheduledAt, scheduledEnd,
        leadSource: a.leadSource ?? null,
      });
      await logActivity('booking.created', `${booking.name} added via ${via} (${booking.service || 'no service'})`, { bookingId: booking.id }, actor);
      // Report what's actually in the database, not what we meant to save.
      const saved = await getBookingById(booking.id);
      if (!saved) return { error: `Booking ${booking.id} could not be read back after saving — check search_bookings before retrying.` };
      return { id: saved.id, result: { created: true, verified: { reReadFromDatabase: true }, booking: bookingView(saved) } };
      }, fetchBooking);
    });

  tool('update_booking', 'Update a booking',
    'Changes fields on one booking by id (BK-…): contact details, services, status, price, paid, completion date, customer notes. addAdminNote APPENDS a dated private note (it never replaces existing notes). Only the fields you pass are changed.',
    {
      id,
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().max(40).optional(), email: z.string().trim().max(200).optional(),
      address: z.string().trim().max(300).optional(), suburb: z.string().trim().max(100).optional(),
      services: z.array(z.enum(SERVICES)).min(1).max(5).optional(),
      propertyType: z.enum(['residential', 'commercial']).optional(),
      status: z.enum(STATUSES).optional(),
      quoteAmount: money.nullable().optional(),
      paid: z.boolean().optional(),
      completedDate: date.optional().describe('YYYY-MM-DD the job was done'),
      preferredDate: date.optional(), preferredTime: z.string().max(40).optional(),
      notes: z.string().max(4000).optional().describe('REPLACES the customer-visible notes'),
      addAdminNote: z.string().trim().min(1).max(2000).optional().describe('Appended to the private admin notes with a date stamp'),
    },
    async ({ id: bookingId, services, completedDate, addAdminNote, ...rest }) => {
      const before = await getBookingById(bookingId);
      if (!before || before.deletedAt) return { error: `No booking with id ${bookingId}. Use search_bookings to find the right id.` };
      const updates: Partial<Booking> = { ...rest };
      if (services) updates.service = services.join(',') as ServiceType;
      if (completedDate) updates.completedAt = new Date(`${completedDate}T12:00:00+10:00`).toISOString();
      if (addAdminNote) {
        const stamp = toSydney(new Date().toISOString())!;
        updates.adminNotes = `${before.adminNotes ? `${before.adminNotes}\n\n` : ''}[${stamp.date} ${stamp.time} · via ${via}] ${addAdminNote}`;
      }
      if (Object.keys(updates).length === 0) return { error: 'Nothing to change — pass at least one field.' };
      const after = await updateBooking(bookingId, updates);
      if (!after) return { error: 'Booking not found.' };
      await afterStatusChange(before, after, actor);
      return { updated: true, changedFields: Object.keys(updates), booking: bookingView(after) };
    });

  // ── Calendar ─────────────────────────────────────────────────────────────

  tool('schedule_booking', 'Put a booking on the calendar',
    'Sets (or moves) a booking\'s calendar slot, like dragging it onto the admin calendar. visitType "job" marks it Confirmed; "quote_visit" marks it Quote Booked. Refuses if the slot overlaps another booking unless allowOverlap is true — tell the owner about the clash first. clear=true takes it off the calendar.',
    {
      id,
      start: localDateTime.optional().describe('Sydney local start, YYYY-MM-DDTHH:MM'),
      durationMinutes: z.number().int().min(15).max(720).optional().describe('Default 120'),
      visitType: z.enum(['job', 'quote_visit']).optional().describe('Default job'),
      allowOverlap: z.boolean().optional(),
      clear: z.boolean().optional(),
    },
    async ({ id: bookingId, start, durationMinutes, visitType, allowOverlap, clear }) => {
      const before = await getBookingById(bookingId);
      if (!before || before.deletedAt) return { error: `No booking with id ${bookingId}.` };
      if (clear) {
        const after = await updateBooking(bookingId, { scheduledAt: null, scheduledEnd: null });
        await logActivity('booking.unscheduled', `${before.name} taken off the calendar via ${via}`, { bookingId }, actor);
        return { updated: true, booking: after ? bookingView(after) : null };
      }
      if (!start) return { error: 'Give a start time (or clear=true to unschedule).' };
      const scheduledAt = sydneyLocalToIso(start);
      if (!scheduledAt) return { error: `${start} isn't a valid Sydney time (it may fall in the daylight-saving gap).` };
      const scheduledEnd = new Date(Date.parse(scheduledAt) + (durationMinutes ?? 120) * 60_000).toISOString();

      // Overlap check against everything else on the calendar that day (±1 day covers long slots).
      const dayMs = 86400_000;
      const nearby = await getBookingsInRange(new Date(Date.parse(scheduledAt) - dayMs).toISOString(), new Date(Date.parse(scheduledEnd) + dayMs).toISOString());
      const clashes = nearby.filter(o => o.id !== bookingId && o.status !== 'cancelled' && o.scheduledAt && (() => {
        const oStart = Date.parse(o.scheduledAt!);
        const oEnd = o.scheduledEnd ? Date.parse(o.scheduledEnd) : oStart + 120 * 60_000;
        return oStart < Date.parse(scheduledEnd) && Date.parse(scheduledAt) < oEnd;
      })());
      if (clashes.length && !allowOverlap) {
        return {
          error: `That slot overlaps ${clashes.length} other booking(s): ${clashes.map(c => `${c.name} (${c.id}) at ${toSydney(c.scheduledAt!)?.label}`).join('; ')}. Ask the owner, then retry with allowOverlap=true or pick another time.`,
        };
      }
      const status: BookingStatus = (visitType ?? 'job') === 'quote_visit' ? 'quote-booked' : 'confirmed';
      const after = await updateBooking(bookingId, { scheduledAt, scheduledEnd, status });
      if (!after) return { error: 'Booking not found.' };
      await logActivity('booking.scheduled', `${after.name} scheduled for ${toSydney(scheduledAt)?.label} via ${via}`, { bookingId, scheduledAt }, actor);
      await afterStatusChange(before, after, actor);
      return { updated: true, booking: bookingView(after), overlapsAllowed: clashes.map(c => c.id) };
    });

  // ── Quotes ───────────────────────────────────────────────────────────────

  tool('create_quote', 'Create a quote',
    `Creates a quote for a booking (same as the admin quote maker) and returns its customer link. Pricing: items = fixed services/extras with a price each (keys: ${QUOTE_ITEM_KEYS.join(', ')}; inside window cleaning needs outside too); otherLines = anything else, with NEGATIVE amounts for discounts (e.g. "Meta ads discount", -100). quoteType "packages" = the three-package window quote (Essential / Complete / Premium Detail): give completePrice (before discounts) and only window cleaning items; the other two prices are worked out automatically. status "sent" marks it as sent; default draft (nothing is sent to the customer either way). A DRAFT quote never changes the booking. A SENT quote moves an open lead (uncontacted/contacted, or a quote visit already done) to Quoted with the quote total as its price; confirmed, completed, paid, cancelled and cold bookings and upcoming quote visits are never changed. The result is re-read from the database; report bookingChanges to the owner.`,
    {
      bookingId: id,
      quoteType: z.enum(['single', 'packages']).optional(),
      items: z.array(z.object({ key: z.enum(QUOTE_ITEM_KEYS), amount: money })).max(10).optional(),
      completePrice: z.number().positive().max(100000).optional().describe('packages only: Complete package price before discounts'),
      otherLines: z.array(z.object({ description: z.string().trim().min(1).max(200), amount: money })).max(20).optional(),
      scope: z.string().max(4000).optional().describe('What is included: window counts, inside/outside, storeys, exclusions'),
      assumptions: z.string().max(4000).optional(),
      notes: z.string().max(4000).optional(),
      validDays: z.number().int().min(1).max(365).optional().describe(`Default ${QUOTE_VALID_DAYS}`),
      status: z.enum(['draft', 'sent']).optional(),
      requestId: requestIdSchema,
    },
    async a => {
      const booking = await getBookingById(a.bookingId);
      if (!booking || booking.deletedAt) return { error: `No booking with id ${a.bookingId}.` };
      const items = a.items ?? [];
      const keys = items.map(i => i.key);
      const settings = await getSettings();
      const quoteDate = sydneyToday();
      const input: QuoteInput = {
        bookingId: booking.id,
        status: a.status ?? 'draft',
        services: keys.filter(k => QUOTE_SERVICE_OPTIONS.some(o => o.key === k)),
        extras: keys.filter(k => QUOTE_EXTRA_OPTIONS.some(o => o.key === k)),
        itemAmounts: Object.fromEntries(items.map(i => [i.key, i.amount])),
        otherLines: (a.otherLines ?? []).map((l, i) => ({ id: `ol-${i}`, description: l.description, amount: l.amount })),
        amount: 0,
        scope: a.scope ?? '',
        assumptions: a.assumptions ?? DEFAULT_QUOTE_ASSUMPTIONS,
        paymentTerms: DEFAULT_PAYMENT_DUE_TERMS,
        propertyType: booking.propertyType,
        billToName: booking.name,
        billToAddress: [booking.address, booking.suburb].filter(Boolean).join(', '),
        ...BUSINESS_DEFAULTS,
        showFromAddress: settings.defaultShowAddressOnQuote,
        quoteDate,
        validUntil: addDays(quoteDate, a.validDays ?? QUOTE_VALID_DAYS),
        notes: a.notes ?? '',
        termsText: DEFAULT_QUOTE_TERMS,
      };
      if (!input.services.length && !input.extras.length && !input.otherLines.length) {
        return { error: 'Add at least one item or other line.' };
      }
      input.amount = items.reduce((s, i) => s + i.amount, 0) + input.otherLines.reduce((s, l) => s + l.amount, 0);
      const pkg = resolvePackageFields(
        { quoteType: a.quoteType, packagePrices: a.completePrice != null ? { complete: Math.round(a.completePrice * 100) } : undefined },
        input, packagePercentsFromSettings(settings),
      );
      if ('error' in pkg) return { error: pkg.error };
      input.quoteType = pkg.quoteType;
      input.packagePrices = pkg.packagePrices;
      input.termsText = pkg.termsText;
      if (pkg.amount != null) input.amount = pkg.amount;
      const expectedAmount = input.amount;
      const fetchQuote = async (quoteId: string) => {
        const q = await getQuoteById(quoteId);
        return q ? { created: true, quote: q, customerLink: link(`/quote/${q.token}`) } : null;
      };
      return once('create_quote', a.requestId, async () => {
        // syncBooking:false — applyQuoteToBooking below decides what the booking gets.
        const quote = await createQuote(input, { syncBooking: false });
        const saved = await getQuoteById(quote.id);
        if (!saved) return { error: `Quote ${quote.number} could not be read back after saving — check list_quotes before retrying.` };
        const bookingChanges = await applyQuoteToBooking(saved);
        await logActivity('quote.created', `Quote ${saved.number} created via ${via} ($${saved.amount})`, { quoteId: saved.id, bookingId: saved.bookingId }, actor);
        return {
          id: saved.id,
          result: {
            created: true,
            verified: { reReadFromDatabase: true, totalAsCalculated: Math.abs(saved.amount - expectedAmount) < 0.005, expectedTotal: expectedAmount, savedTotal: saved.amount },
            quote: saved, bookingChanges, customerLink: link(`/quote/${saved.token}`),
          },
        };
      }, fetchQuote);
    });

  tool('update_quote', 'Update a quote',
    'Updates a quote by id (QT-…) or number (Q1003; "Q-1003" or "1003" also work): mark it sent, or change its scope, notes, assumptions or expiry. Marking sent does not message the customer. Prices are changed by creating a new quote. The result is re-read from the database.',
    {
      idOrNumber: docRef,
      status: z.enum(['draft', 'sent']).optional(),
      scope: z.string().max(4000).optional(), notes: z.string().max(4000).optional(),
      assumptions: z.string().max(4000).optional(), validUntil: date.optional(),
    },
    async ({ idOrNumber, ...updates }) => {
      const q = await findQuote(idOrNumber);
      if (!q) return { error: `No quote ${idOrNumber}.` };
      if (Object.keys(updates).length === 0) return { error: 'Nothing to change.' };
      const result = await updateQuote(q.id, updates);
      if (!result) return { error: 'Quote not found.' };
      const saved = await getQuoteById(q.id);
      if (!saved) return { error: `Quote ${q.number} could not be read back after saving.` };
      const bookingChanges = updates.status === 'sent' && q.status !== 'sent'
        ? await applyQuoteToBooking(saved)
        : { changed: [], reason: 'Booking not changed.' };
      await logActivity('quote.updated', `Quote ${saved.number} updated via ${via} (${Object.keys(updates).join(', ')})`, { quoteId: saved.id, bookingId: saved.bookingId }, actor);
      return { updated: true, verified: { reReadFromDatabase: true }, quote: saved, bookingChanges, customerLink: link(`/quote/${saved.token}`) };
    });

  // ── Invoices ─────────────────────────────────────────────────────────────

  tool('create_invoice', 'Create an invoice',
    'Creates an invoice (same as the admin invoice editor) and returns its customer link. Give bookingId to link it to a job and fill the bill-to details from it; if items are left out, one line is made from the booking\'s service and price. Negative item amounts are discounts.',
    {
      bookingId: id.optional(),
      items: z.array(z.object({
        description: z.string().trim().min(1).max(200), amount: money,
        detail: z.string().max(1000).optional(), date: date.optional(),
      })).max(30).optional(),
      billToName: z.string().max(200).optional(), billToLines: z.string().max(500).optional(),
      invoiceDate: date.optional().describe('Default today'), dueDate: date.optional().describe('Default per payment terms'),
      isTaxInvoice: z.boolean().optional(),
      status: z.enum(['draft', 'sent']).optional().describe('Default draft. Marking sent does not email or text the customer.'),
      notes: z.string().max(4000).optional(),
      requestId: requestIdSchema,
    },
    async a => {
      const booking = a.bookingId ? await getBookingById(a.bookingId) : null;
      if (a.bookingId && (!booking || booking.deletedAt)) return { error: `No booking with id ${a.bookingId}.` };
      const items = a.items?.length
        ? a.items
        : booking && typeof booking.quoteAmount === 'number' && booking.quoteAmount > 0
          ? [{ description: booking.service.split(',').map(s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())).join(' + ') || 'Cleaning', amount: booking.quoteAmount }]
          : [];
      if (!items.length) return { error: 'Give at least one line item (the booking has no price to invoice from).' };
      const invoiceDate = a.invoiceDate ?? sydneyToday();
      const settings = await getSettings();
      const isTaxInvoice = !!a.isTaxInvoice;
      const input: InvoiceInput = {
        isTaxInvoice,
        status: a.status ?? 'draft',
        ...BUSINESS_DEFAULTS,
        showFromAddress: isTaxInvoice ? true : settings.defaultShowAddressOnInvoice,
        billToName: a.billToName ?? booking?.name ?? '',
        billToLines: a.billToLines ?? (booking ? [booking.address, booking.suburb].filter(Boolean).join(', ') : ''),
        client: { show: false, clientName: '', trn: '', fileNo: '', claimRef: '' },
        invoiceDate,
        serviceDate: booking?.completedAt?.slice(0, 10) ?? '',
        dueDate: a.dueDate ?? addDays(invoiceDate, paymentDueTermsDays(DEFAULT_PAYMENT_DUE_TERMS)),
        items: items.map(it => ({
          description: it.description, detail: 'detail' in it ? it.detail ?? '' : '',
          serviceAddress: booking ? [booking.address, booking.suburb].filter(Boolean).join(', ') : '',
          date: 'date' in it ? it.date ?? '' : '', amount: it.amount,
        })),
        notes: a.notes ?? '',
        payAccountName: PAYMENT_DEFAULTS.payAccountName,
        payBsb: PAYMENT_DEFAULTS.payBsb,
        payAccountNumber: PAYMENT_DEFAULTS.payAccountNumber,
        bookingId: booking?.id ?? null,
        bookingIds: booking ? [booking.id] : [],
        ownerGuestId: null,
      };
      const fetchInvoice = async (invoiceId: string) => {
        const inv = await getInvoiceById(invoiceId);
        return inv ? { created: true, invoice: inv, customerLink: link(`/invoice/${inv.token}`) } : null;
      };
      return once('create_invoice', a.requestId, async () => {
        const invoice = await createInvoice(input);
        const saved = await getInvoiceById(invoice.id);
        if (!saved) return { error: `Invoice ${invoice.number} could not be read back after saving — check list_invoices before retrying.` };
        await logActivity('invoice.created', `Invoice ${saved.number} created via ${via} for ${saved.billToName || 'no recipient'}`, { invoiceId: saved.id, total: saved.total }, actor);
        const lineSum = saved.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
        return {
          id: saved.id,
          result: {
            created: true,
            verified: { reReadFromDatabase: true, totalEqualsLineItems: Math.abs(saved.total - lineSum) < 0.005, lineItemSum: lineSum, savedTotal: saved.total },
            invoice: saved, customerLink: link(`/invoice/${saved.token}`),
          },
        };
      }, fetchInvoice);
    });

  tool('update_invoice_status', 'Mark an invoice sent / paid / cancelled',
    'Changes an invoice\'s status by id (INV-…) or number (GB1050). For "paid" give paymentMethod (and paidDate if not today); marking an invoice paid does NOT change the booking — use update_booking paid=true for that if the owner wants.',
    {
      idOrNumber: docRef,
      status: z.enum(['draft', 'sent', 'paid', 'cancelled']),
      paymentMethod: z.enum(['bank_transfer', 'cash', 'card', 'other']).optional(),
      paidDate: date.optional(),
    },
    async ({ idOrNumber, status, paymentMethod, paidDate }) => {
      const inv = await findInvoice(idOrNumber);
      if (!inv) return { error: `No invoice ${idOrNumber}.` };
      if (status === 'paid' && !paymentMethod) return { error: 'Say how it was paid (paymentMethod).' };
      const updates: Partial<Invoice> = { status };
      if (status === 'paid') {
        updates.paymentMethod = paymentMethod!;
        updates.paidAt = paidDate ? new Date(`${paidDate}T12:00:00+10:00`).toISOString() : new Date().toISOString();
      }
      if (status === 'sent' && !inv.sentAt) updates.sentAt = new Date().toISOString();
      const saved = await updateInvoice(inv.id, updates);
      if (!saved) return { error: 'Invoice not found.' };
      if (saved.status !== inv.status) {
        await logActivity('invoice.status_changed', `${saved.number} ${inv.status} -> ${saved.status}${status === 'paid' ? ` (${paymentMethod})` : ''} via ${via}`, { from: inv.status, to: saved.status, paymentMethod: saved.paymentMethod }, actor, saved.id);
      }
      return { updated: true, invoice: saved, customerLink: link(`/invoice/${saved.token}`) };
    });

  // ── Recurring customers ──────────────────────────────────────────────────

  tool('make_recurring_customer', 'Make a booking\'s customer a recurring customer',
    'Creates a recurring customer profile from a booking (same as "Make recurring customer" in the admin) and links their other bookings by phone/email. frequency: monthly ($100 off), quarterly ($75 off), biannual (twice a year, $50 off) — the discount defaults to the website tier — or custom with customInterval + customIntervalUnit. visitPrice = usual price per clean before discount. Returns their portal link + PIN.',
    {
      bookingId: id,
      frequency: z.enum(['monthly', 'quarterly', 'biannual', 'custom']),
      customInterval: z.number().int().min(1).max(52).optional(),
      customIntervalUnit: z.enum(['weeks', 'months', 'years']).optional(),
      discount: z.number().min(0).max(10000).optional(),
      visitPrice: z.number().positive().max(100000).optional(),
    },
    async a => {
      if (a.frequency === 'custom' && !a.customInterval) return { error: 'Custom needs customInterval (and customIntervalUnit).' };
      const booking = await getBookingById(a.bookingId);
      const result = await createProfileFromBooking(a.bookingId, {
        frequency: a.frequency,
        customInterval: a.frequency === 'custom' ? a.customInterval! : null,
        customIntervalUnit: a.customIntervalUnit ?? 'weeks',
        discount: a.discount ?? presetDiscount(a.frequency),
        visitPrice: a.visitPrice ?? (booking?.quoteAmount && booking.quoteAmount > 0 ? booking.quoteAmount : null),
      });
      if (!result) return { error: `No booking with id ${a.bookingId}.` };
      await logActivity('recurring.created', `${result.job.name} made a recurring customer via ${via}`, { recurringId: result.job.id, bookingId: a.bookingId }, actor);
      return {
        created: true, profile: { ...result.job, portal: undefined }, linkedBookings: result.linked,
        adminLink: `/admin/recurring/${result.job.id}`,
        portal: result.job.portal ? { link: link(`/portal/${result.job.portal.token}`), pin: result.job.portal.pin } : null,
      };
    });

  tool('create_recurring_job', 'Book a job for a recurring customer',
    'Creates a job under a recurring customer profile (RJ-…), with their details and plan discount applied (discount only on jobs over $200). Goes on the calendar at the Sydney local start time if given. price = before discount; defaults to their usual price.',
    {
      profileId: id,
      date: date,
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe('HH:MM Sydney time; leave out for no calendar slot yet'),
      price: z.number().positive().max(100000).optional(),
      notes: z.string().max(4000).optional(),
    },
    async a => {
      const profile = (await getRecurringJobs()).find(j => j.id === a.profileId);
      if (!profile) return { error: `No recurring customer ${a.profileId}. Use list_recurring_plans.` };
      const scheduledAt = a.startTime ? sydneyLocalToIso(`${a.date}T${a.startTime}`) : null;
      if (a.startTime && !scheduledAt) return { error: 'That start time isn\'t a valid Sydney time.' };
      const result = await createJobForProfile(profile.id, { date: a.date, scheduledAt, price: a.price ?? profile.visitPrice, notes: a.notes });
      if (!result) return { error: 'Recurring customer not found.' };
      await logActivity('booking.created', `${result.booking.name} recurring job added via ${via} for ${a.date}`, { bookingId: result.booking.id, recurringId: profile.id }, actor);
      return { created: true, booking: bookingView(result.booking), nextVisitDue: result.job.nextDate };
    });

  tool('book_next_recurring_visit', 'Book a recurring customer\'s next due visit',
    'Books the next due visit for a recurring customer profile (RJ-…) on its due date at the default start time, confirmed and on the calendar, and moves the plan on one cycle — same as "Book next visit" in the admin.',
    { profileId: id },
    async ({ profileId }) => {
      const result = await generateNextVisit(profileId);
      if (!result) return { error: `No recurring customer ${profileId}.` };
      await logActivity('booking.created', `${result.booking.name} next recurring visit booked via ${via}`, { bookingId: result.booking.id, recurringId: profileId }, actor);
      return { created: true, booking: bookingView(result.booking), nextVisitDue: result.job.nextDate };
    });
}
