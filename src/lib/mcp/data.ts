// Read-only data access for the MCP tools. Every function here takes the
// ReadDb (read-only role + READ ONLY transaction) and only ever SELECTs.
//
// Demo data: LARP mode ("make us look busy", src/lib/larp.ts) inserts fake
// rows with ids prefixed `LARP-` (and page views with visitor `larp_...`).
// Those are always excluded here, same as the local Claude connector.

import { type ReadDb, type Row, readOne } from './sql';
import {
  toRecord, Where, contains, likeEscape, PHONE_CORE_SQL, phoneCore, startPage, buildPage, pageArray,
  type Page, type PageStart, normalizeTimestamp,
} from './records';
import { sydneyDayStartSql, sydneyDayEndSql, toSydney, sydneyToday, sydneyMonthKey, daysBetween, isIsoDate } from './time';
import { signBlob } from './crypto';
import { FILE_LINK_TTL_SECONDS } from './config';
import { serviceLabel, paymentTermsText, quoteTotal, type QuoteOtherLine } from '../quote';
import { GST_NOTE, PAYMENT_METHOD_LABEL, cardTotal, isInvoiceOverdue, debtorDays, type PaymentMethod } from '../invoice';
import { LEAD_SOURCES, advanceDate, type RecurringFrequency } from '../db';
import { DEFAULT_SETTINGS } from '../settings';
import { ACTIVITY_TYPE_LABEL } from '../activity';
import { computePageEngagement, computeScrollBuckets, computeSiteWideTimeStats, computeBookingFunnel } from '../analytics';

export interface Ctx {
  db: ReadDb;
  baseUrl: string;
  secret: string;
}

const NOT_LARP = (col = 'id') => `${col} NOT LIKE 'LARP-%'`;
export const isLarpId = (id: string) => id.startsWith('LARP-');

// Calendar convention (src/app/admin/calendar/page.tsx + dashboard): a
// scheduled booking still at an early status is a QUOTE VISIT; anything
// further along is a JOB.
export const QUOTE_VISIT_STATUSES = ['uncontacted', 'contacted', 'quote-booked'];
export const BOOKING_STATUSES = ['uncontacted', 'contacted', 'quote-booked', 'quoted', 'confirmed', 'completed', 'cancelled', 'cold'] as const;
export const BOOKING_SOURCES = ['website', 'manual', 'facebook-lead-ad'] as const;

const BOOKING_SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window cleaning', 'pressure-washing': 'Pressure washing', 'flyscreen-repair': 'Flyscreen repair',
  'solar-panel-cleaning': 'Solar panel cleaning', other: 'Other', both: 'Window + pressure washing (legacy "both")',
};

// ─── Record shapers ─────────────────────────────────────────────────────────

export function bookingRecord(row: Row, ctx: Ctx): Record<string, unknown> {
  const r = toRecord(row);
  const services = String(r.service ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const status = String(r.status ?? '');
  const scheduledAt = r.scheduledAt as string | null;
  r.computed = {
    services,
    serviceLabels: services.map(s => BOOKING_SERVICE_LABELS[s] ?? s),
    leadSourceLabel: r.leadSource ? (LEAD_SOURCES.find(l => l.value === r.leadSource)?.label ?? r.leadSource) : null,
    visitType: scheduledAt ? (QUOTE_VISIT_STATUSES.includes(status) ? 'quote_visit' : 'job') : null,
    scheduledStartSydney: toSydney(scheduledAt),
    scheduledEndSydney: toSydney(r.scheduledEnd as string | null),
    createdSydney: toSydney(r.createdAt as string),
    isDeleted: r.deletedAt != null,
    thankYouPageUrl: r.publicToken ? `${ctx.baseUrl}/thanks/${r.publicToken}` : null,
    adminUrl: `${ctx.baseUrl}/admin/bookings/${r.id}`,
  };
  return r;
}

function quoteLines(q: Record<string, unknown>) {
  const services = (q.services as string[] | null) ?? [];
  const extras = (q.extras as string[] | null) ?? [];
  const itemAmounts = (q.itemAmounts as Record<string, number> | null) ?? {};
  const otherLines = (q.otherLines as QuoteOtherLine[] | null) ?? [];
  return [
    ...services.map(k => ({ kind: 'service', key: k, description: serviceLabel(k), amount: Number(itemAmounts[k]) || 0 })),
    ...extras.map(k => ({ kind: 'extra', key: k, description: serviceLabel(k), amount: Number(itemAmounts[k]) || 0 })),
    ...otherLines.map(l => ({ kind: 'other', key: l.id, description: l.description, amount: Number(l.amount) || 0 })),
  ];
}

export function quoteRecord(row: Row, ctx: Ctx, bookingStatus?: string | null): Record<string, unknown> {
  const r = toRecord(row);
  const lines = quoteLines(r);
  const discount = lines.filter(l => l.amount < 0).reduce((s, l) => s + l.amount, 0);
  const total = quoteTotal({
    services: (r.services as string[]) ?? [], extras: (r.extras as string[]) ?? [],
    itemAmounts: (r.itemAmounts as Record<string, number>) ?? {}, otherLines: (r.otherLines as QuoteOtherLine[]) ?? [],
  });
  const validUntil = String(r.validUntil ?? '');
  r.computed = {
    lineItems: lines,
    subtotalBeforeDiscounts: total - discount,
    discountTotal: discount,
    total,
    storedAmountMatchesLines: Math.abs(total - Number(r.amount ?? 0)) < 0.005,
    tax: { gstCharged: 0, note: GST_NOTE },
    paymentTermsText: paymentTermsText(String(r.paymentTerms ?? '')),
    expired: isIsoDate(validUntil) ? validUntil < sydneyToday() : null,
    // There is no acceptance field on quotes (status is only draft/sent).
    // Acceptance is inferred from the linked booking's status.
    acceptance: bookingStatus === undefined ? undefined : inferAcceptance(bookingStatus),
    publicUrl: r.token ? `${ctx.baseUrl}/quote/${r.token}` : null,
  };
  return r;
}

function inferAcceptance(status: string | null) {
  if (status == null) return { state: 'unknown', basis: 'linked booking not found' };
  if (status === 'confirmed' || status === 'completed') return { state: 'accepted_inferred', basis: `linked booking status is "${status}"` };
  if (status === 'cancelled') return { state: 'declined_or_cancelled_inferred', basis: 'linked booking status is "cancelled"' };
  if (status === 'cold') return { state: 'not_accepted_went_cold', basis: 'linked booking status is "cold"' };
  return { state: 'pending', basis: `linked booking status is "${status}"` };
}

export function invoiceRecord(row: Row, ctx: Ctx, squareSurchargePercent?: number): Record<string, unknown> {
  const r = toRecord(row);
  const status = String(r.status ?? '');
  const total = Number(r.total ?? 0);
  const paid = status === 'paid';
  r.computed = {
    paymentStatus: paid ? 'paid' : status === 'cancelled' ? 'cancelled' : status === 'draft' ? 'draft_not_sent' : (isInvoiceOverdue({ status: status as 'sent', dueDate: String(r.dueDate ?? '') }) ? 'overdue' : 'awaiting_payment'),
    amountPaid: paid ? total : 0,
    outstandingBalance: paid || status === 'cancelled' ? 0 : total,
    paymentNote: 'No partial payments are recorded by the admin: an invoice is either fully paid (status "paid", paidAt, paymentMethod) or not.',
    paymentMethodLabel: r.paymentMethod ? (PAYMENT_METHOD_LABEL[r.paymentMethod as PaymentMethod] ?? r.paymentMethod) : null,
    debtorDays: debtorDays({ sentAt: r.sentAt as string | null, paidAt: r.paidAt as string | null }),
    tax: { gstCharged: 0, documentTitle: r.isTaxInvoice ? 'Tax Invoice' : 'Invoice', note: GST_NOTE },
    cardTotalWithSurcharge: squareSurchargePercent != null ? cardTotal(total, squareSurchargePercent) : null,
    publicUrl: r.token ? `${ctx.baseUrl}/invoice/${r.token}` : null,
    adminUrl: `${ctx.baseUrl}/admin/invoices/${r.id}`,
  };
  return r;
}

export function photoRecord(row: Row, ctx: Ctx): Record<string, unknown> {
  const r = toRecord(row, ['url']); // raw Blob URLs are never returned — signed, expiring links only
  const exp = Math.floor(Date.now() / 1000) + FILE_LINK_TTL_SECONDS;
  const sig = signBlob('file-link', { id: r.id, exp }, ctx.secret);
  r.computed = {
    viewUrl: `${ctx.baseUrl}/api/mcp-files/photo?t=${encodeURIComponent(sig)}`,
    viewUrlExpiresAt: new Date(exp * 1000).toISOString(),
  };
  return r;
}

const GUEST_COLS = 'id, name, active, created_at'; // password_hash is never selected (and not granted)

export function activityRecord(row: Row): Record<string, unknown> {
  const r = toRecord(row);
  const type = String(r.type ?? '');
  if (type.startsWith('vault.')) {
    // Vault item labels can describe secrets — redact them.
    r.summary = ACTIVITY_TYPE_LABEL[type] ?? type;
    r.meta = null;
    r.redacted = 'vault activity details are excluded';
  }
  r.typeLabel = ACTIVITY_TYPE_LABEL[type] ?? type;
  return r;
}

// ─── Bookings (customers / leads / jobs) ────────────────────────────────────

export interface BookingFilters {
  query?: string; name?: string; phone?: string; email?: string; address?: string; suburb?: string;
  notesContains?: string;
  ids?: string[];
  status?: string[]; source?: string[]; leadSource?: string[]; attributionSource?: string;
  service?: string; propertyType?: string;
  createdFrom?: string; createdTo?: string;
  scheduledFrom?: string; scheduledTo?: string;
  completedFrom?: string; completedTo?: string;
  updatedFrom?: string; updatedTo?: string;
  preferredDateFrom?: string; preferredDateTo?: string;
  paid?: boolean; hasQuoteAmount?: boolean; isScheduled?: boolean; flagged?: boolean;
  assignedGuestId?: string; recurringId?: string; groupId?: string;
  deleted?: 'exclude' | 'include' | 'only';
  sort?: 'created_desc' | 'created_asc' | 'updated_desc' | 'scheduled_asc' | 'scheduled_desc' | 'name_asc';
}

function dateRange(w: Where, col: string, from?: string, to?: string) {
  if (from) w.add(`${col} >= ${sydneyDayStartSql(w.p(from))}`);
  if (to) w.add(`${col} < ${sydneyDayEndSql(w.p(to))}`);
}

const BOOKING_TEXT_COLS = ['name', 'email', 'phone', 'address', 'suburb', 'id', 'notes', 'admin_notes', 'flag_note', 'external_lead_id', 'feedback_text'];

export function bookingWhere(f: BookingFilters, asOf: string | null): Where {
  const w = new Where();
  w.add(NOT_LARP());
  const deleted = f.deleted ?? 'exclude';
  if (deleted === 'exclude') w.add('deleted_at IS NULL');
  if (deleted === 'only') w.add('deleted_at IS NOT NULL');
  if (asOf) w.add(`created_at <= ${w.p(asOf)}`);
  if (f.query) {
    for (const term of f.query.trim().split(/\s+/).slice(0, 8)) {
      const ph = w.p(contains(term));
      const ors = BOOKING_TEXT_COLS.map(c => `coalesce(${c}, '') ILIKE ${ph} ESCAPE '\\'`);
      const core = phoneCore(term);
      if (core.length >= 3) ors.push(`${PHONE_CORE_SQL('phone')} LIKE ${w.p(contains(core))} ESCAPE '\\'`);
      w.add(`(${ors.join(' OR ')})`);
    }
  }
  if (f.name) w.add(`name ILIKE ${w.p(contains(f.name.trim()))} ESCAPE '\\'`);
  if (f.email) w.add(`email ILIKE ${w.p(contains(f.email.trim()))} ESCAPE '\\'`);
  if (f.phone) w.add(`${PHONE_CORE_SQL('phone')} LIKE ${w.p(contains(phoneCore(f.phone)))} ESCAPE '\\'`);
  if (f.address) w.add(`address ILIKE ${w.p(contains(f.address.trim()))} ESCAPE '\\'`);
  if (f.suburb) w.add(`suburb ILIKE ${w.p(contains(f.suburb.trim()))} ESCAPE '\\'`);
  if (f.notesContains) {
    const ph = w.p(contains(f.notesContains.trim()));
    w.add(`(coalesce(notes, '') ILIKE ${ph} ESCAPE '\\' OR coalesce(admin_notes, '') ILIKE ${ph} ESCAPE '\\' OR coalesce(flag_note, '') ILIKE ${ph} ESCAPE '\\')`);
  }
  if (f.ids?.length) w.add(`id = ANY(${w.p(f.ids)}::text[])`);
  if (f.status?.length) w.add(`status = ANY(${w.p(f.status)}::text[])`);
  if (f.source?.length) w.add(`source = ANY(${w.p(f.source)}::text[])`);
  if (f.leadSource?.length) w.add(`lead_source = ANY(${w.p(f.leadSource)}::text[])`);
  if (f.attributionSource) w.add(`attribution_source ILIKE ${w.p(contains(f.attributionSource))} ESCAPE '\\'`);
  if (f.service) w.add(`(',' || service || ',') LIKE ${w.p(`%,${likeEscape(f.service)},%`)} ESCAPE '\\'`);
  if (f.propertyType) w.add(`property_type = ${w.p(f.propertyType)}`);
  dateRange(w, 'created_at', f.createdFrom, f.createdTo);
  dateRange(w, 'scheduled_at', f.scheduledFrom, f.scheduledTo);
  dateRange(w, 'completed_at', f.completedFrom, f.completedTo);
  dateRange(w, 'updated_at', f.updatedFrom, f.updatedTo);
  if (f.preferredDateFrom || f.preferredDateTo) w.add(`preferred_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`);
  if (f.preferredDateFrom) w.add(`preferred_date >= ${w.p(f.preferredDateFrom)}`);
  if (f.preferredDateTo) w.add(`preferred_date <= ${w.p(f.preferredDateTo)}`);
  if (f.paid !== undefined) w.add(`paid = ${w.p(f.paid)}`);
  if (f.hasQuoteAmount !== undefined) w.add(f.hasQuoteAmount ? 'quote_amount IS NOT NULL' : 'quote_amount IS NULL');
  if (f.isScheduled !== undefined) w.add(f.isScheduled ? 'scheduled_at IS NOT NULL' : 'scheduled_at IS NULL');
  if (f.flagged !== undefined) w.add(f.flagged ? 'flagged_at IS NOT NULL' : 'flagged_at IS NULL');
  if (f.assignedGuestId) w.add(`assigned_guest_id = ${w.p(f.assignedGuestId)}`);
  if (f.recurringId) w.add(`recurring_id = ${w.p(f.recurringId)}`);
  if (f.groupId) w.add(`group_id = ${w.p(f.groupId)}`);
  return w;
}

const BOOKING_SORT: Record<NonNullable<BookingFilters['sort']>, string> = {
  created_desc: 'created_at DESC, id DESC',
  created_asc: 'created_at ASC, id ASC',
  updated_desc: 'updated_at DESC, id DESC',
  scheduled_asc: 'scheduled_at ASC NULLS LAST, id ASC',
  scheduled_desc: 'scheduled_at DESC NULLS LAST, id DESC',
  name_asc: 'lower(name) ASC, id ASC',
};

export async function searchBookings(ctx: Ctx, f: BookingFilters, cursor?: string, pageSize?: number): Promise<Page<Record<string, unknown>>> {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const w = bookingWhere(f, start.asOf);
  const [countRows, rows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM bookings ${w.sql()}`, params: w.params },
    { text: `SELECT * FROM bookings ${w.sql()} ORDER BY ${BOOKING_SORT[f.sort ?? 'created_desc']} LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
  ]);
  return buildPage(rows.map(r => bookingRecord(r, ctx)), Number(countRows[0]?.n ?? 0), start, ctx.secret);
}

const BOOKING_ID_PATTERN = (idPh: string) => `('%"' || ${idPh} || '"%')`;

export async function getBookingFull(ctx: Ctx, id: string) {
  if (isLarpId(id)) return { error: 'That id belongs to LARP/demo-mode fake data, not a real booking.' };
  const idLike = `%"bookingId":"${likeEscape(id)}"%`;
  const [bk, quotes, invoices, photos, plans, group, guest, related, activity, activityCount] = await ctx.db.many([
    { text: `SELECT * FROM bookings WHERE id = $1`, params: [id] },
    { text: `SELECT * FROM quotes WHERE booking_id = $1 ORDER BY seq`, params: [id] },
    { text: `SELECT * FROM invoices WHERE ${NOT_LARP()} AND (booking_id = $1 OR booking_ids LIKE ${BOOKING_ID_PATTERN('$1')}) ORDER BY seq`, params: [id] },
    { text: `SELECT * FROM booking_photos WHERE booking_id = $1 ORDER BY created_at, id`, params: [id] },
    { text: `SELECT * FROM recurring_jobs WHERE ${NOT_LARP()} AND (id = (SELECT recurring_id FROM bookings WHERE id = $1) OR last_booking_id = $1)`, params: [id] },
    { text: `SELECT g.*, (SELECT count(*)::int FROM bookings b WHERE b.group_id = g.id AND b.deleted_at IS NULL) AS member_count
             FROM booking_groups g WHERE g.id = (SELECT group_id FROM bookings WHERE id = $1)`, params: [id] },
    { text: `SELECT ${GUEST_COLS} FROM guests WHERE id = (SELECT assigned_guest_id FROM bookings WHERE id = $1)`, params: [id] },
    { text: `SELECT o.id, o.name, o.status, o.suburb, o.created_at, o.deleted_at,
               (o.email <> '' AND lower(o.email) = lower(b.email)) AS email_match,
               (length(${PHONE_CORE_SQL('o.phone')}) >= 8 AND ${PHONE_CORE_SQL('o.phone')} = ${PHONE_CORE_SQL('b.phone')}) AS phone_match,
               (o.address <> '' AND lower(trim(o.address)) = lower(trim(b.address))) AS address_match
             FROM bookings o, bookings b
             WHERE b.id = $1 AND o.id <> b.id AND o.id NOT LIKE 'LARP-%' AND (
               (o.email <> '' AND lower(o.email) = lower(b.email))
               OR (length(${PHONE_CORE_SQL('o.phone')}) >= 8 AND ${PHONE_CORE_SQL('o.phone')} = ${PHONE_CORE_SQL('b.phone')})
               OR (o.address <> '' AND lower(trim(o.address)) = lower(trim(b.address))))
             ORDER BY o.created_at DESC LIMIT 100`, params: [id] },
    { text: `SELECT a.* FROM activity_log a WHERE a.meta LIKE $2 ESCAPE '\\'
               OR a.invoice_id IN (SELECT i.id FROM invoices i WHERE i.booking_id = $1 OR i.booking_ids LIKE ${BOOKING_ID_PATTERN('$1')})
               OR EXISTS (SELECT 1 FROM quotes q WHERE q.booking_id = $1 AND a.meta LIKE ('%"quoteId":"' || q.id || '"%'))
             ORDER BY a.created_at DESC LIMIT 500`, params: [id, idLike] },
    { text: `SELECT count(*)::int AS n FROM activity_log a WHERE a.meta LIKE $2 ESCAPE '\\'
               OR a.invoice_id IN (SELECT i.id FROM invoices i WHERE i.booking_id = $1 OR i.booking_ids LIKE ${BOOKING_ID_PATTERN('$1')})
               OR EXISTS (SELECT 1 FROM quotes q WHERE q.booking_id = $1 AND a.meta LIKE ('%"quoteId":"' || q.id || '"%'))`, params: [id, idLike] },
  ]);
  if (!bk[0]) return { error: `No booking found with id ${id}. Use search_bookings to find the right id.` };
  const booking = bookingRecord(bk[0], ctx);
  const status = String(bk[0].status);
  const settings = await getSettingsObject(ctx);
  return {
    booking,
    linked: {
      quotes: quotes.map(q => quoteRecord(q, ctx, status)),
      invoices: invoices.map(i => invoiceRecord(i, ctx, settings.squareSurchargePercent as number)),
      photos: photos.map(p => photoRecord(p, ctx)),
      recurringPlans: plans.map(p => ({ ...toRecord(p), relation: p.id === bk[0].recurring_id ? 'generated_this_booking' : 'last_booking_of_plan' })),
      group: group[0] ? toRecord(group[0]) : null,
      assignedSubcontractor: guest[0] ? toRecord(guest[0]) : (bk[0].assigned_guest_id ? { id: bk[0].assigned_guest_id, missing: true } : null),
      otherRecordsForSameCustomer: related.map(r => toRecord(r)),
      otherRecordsNote: 'Matched on exact email, same phone number (last digits ignoring +61/0), or identical address. Use get_customer_history for full details.',
      activityHistory: {
        total: Number(activityCount[0]?.n ?? 0),
        returned: activity.length,
        truncated: Number(activityCount[0]?.n ?? 0) > activity.length,
        items: activity.map(activityRecord),
        moreVia: 'list_activity with bookingId',
      },
    },
  };
}

// ─── Customer history (there is no separate customer table) ────────────────

export async function getCustomerHistory(ctx: Ctx, by: { bookingId?: string; phone?: string; email?: string; name?: string; address?: string }) {
  let phone = by.phone ? phoneCore(by.phone) : '';
  let email = (by.email ?? '').trim().toLowerCase();
  let address = (by.address ?? '').trim().toLowerCase();
  let name = (by.name ?? '').trim().toLowerCase();
  if (by.bookingId) {
    const rows = await readOne(ctx.db, `SELECT name, phone, email, address FROM bookings WHERE id = $1 AND ${NOT_LARP()}`, [by.bookingId]);
    if (!rows[0]) return { error: `No booking found with id ${by.bookingId}.` };
    phone = phone || phoneCore(String(rows[0].phone ?? ''));
    email = email || String(rows[0].email ?? '').trim().toLowerCase();
    address = address || String(rows[0].address ?? '').trim().toLowerCase();
    name = name || String(rows[0].name ?? '').trim().toLowerCase();
  }
  if (phone.length < 8) phone = '';
  if (!phone && !email && !address && !name) return { error: 'Provide bookingId, phone (8+ digits), email, address or name.' };

  const LIMIT = 200;
  // One set of placeholders shared by the WHERE clause and the "why it
  // matched" columns, so every query built from it uses exactly its params.
  const build = (alias: string) => {
    const w = new Where();
    const ph = { phone: phone ? w.p(phone) : '', email: email ? w.p(email) : '', address: address ? w.p(address) : '',
      name: name && !phone && !email && !address ? w.p(name) : '' };
    const conds = {
      phone: ph.phone ? `${PHONE_CORE_SQL(`${alias}.phone`)} = ${ph.phone}` : 'false',
      email: ph.email ? `lower(${alias}.email) = ${ph.email}` : 'false',
      address: ph.address ? `lower(trim(${alias}.address)) = ${ph.address}` : 'false',
    };
    const ors = [conds.phone, conds.email, conds.address, ph.name ? `lower(trim(${alias}.name)) = ${ph.name}` : 'false'];
    return {
      w,
      match: `(${ors.join(' OR ')})`,
      why: `(${conds.phone}) AS phone_match, (${conds.email}) AS email_match, (${conds.address}) AS address_match`,
    };
  };
  const { w: wb, match: bm, why: bwhy } = build('b');
  const { w: wr, match: rm, why: rwhy } = build('r');
  const [bookings, bookingCount, plans] = await ctx.db.many([
    { text: `SELECT b.*, ${bwhy} FROM bookings b WHERE b.id NOT LIKE 'LARP-%' AND ${bm} ORDER BY b.created_at DESC LIMIT ${LIMIT}`, params: wb.params },
    { text: `SELECT count(*)::int AS n FROM bookings b WHERE b.id NOT LIKE 'LARP-%' AND ${bm}`, params: wb.params },
    { text: `SELECT r.*, ${rwhy} FROM recurring_jobs r WHERE r.id NOT LIKE 'LARP-%' AND ${rm} ORDER BY r.created_at DESC`, params: wr.params },
  ]);
  const ids = bookings.map(b => String(b.id));
  const [quotes, invoices] = ids.length ? await ctx.db.many([
    { text: `SELECT * FROM quotes WHERE booking_id = ANY($1::text[]) ORDER BY seq`, params: [ids] },
    { text: `SELECT * FROM invoices WHERE ${NOT_LARP()} AND (booking_id = ANY($1::text[]) OR EXISTS (SELECT 1 FROM unnest($1::text[]) x WHERE booking_ids LIKE ('%"' || x || '"%'))) ORDER BY seq`, params: [ids] },
  ]) : [[], []];
  const statusById = new Map(bookings.map(b => [String(b.id), String(b.status)]));
  const strip = (r: Record<string, unknown>) => {
    const matchedOn = (['phone', 'email', 'address'] as const).filter(k => r[`${k}Match`]);
    delete r.phoneMatch; delete r.emailMatch; delete r.addressMatch;
    return { ...r, matchedOn: matchedOn.length ? matchedOn : ['name'] };
  };
  const total = Number(bookingCount[0]?.n ?? 0);
  return {
    matchedBy: { phoneDigits: phone || null, email: email || null, address: address || null, nameOnly: !phone && !email && !address ? name : null },
    note: 'There is no customer table: a customer is the set of bookings/plans sharing a phone number, email or exact address. Different people can share an address, so check matchedOn before treating records as one person.',
    bookings: { total, returned: bookings.length, truncated: total > bookings.length, items: bookings.map(b => strip(bookingRecord(b, ctx))) },
    recurringPlans: plans.map(p => strip(toRecord(p))),
    quotes: quotes.map(q => quoteRecord(q, ctx, statusById.get(String(q.booking_id)) ?? null)),
    invoices: invoices.map(i => invoiceRecord(i, ctx)),
  };
}

// ─── Schedule (Australia/Sydney) ────────────────────────────────────────────

export interface ScheduleArgs {
  from: string; to: string;
  kind: 'scheduled' | 'requested_unscheduled' | 'recurring_projected';
  visitType?: 'all' | 'jobs' | 'quote_visits';
  includeCancelled?: boolean;
  assignedGuestId?: string;
}

export async function listSchedule(ctx: Ctx, a: ScheduleArgs, cursor?: string, pageSize?: number) {
  const start = startPage(a, cursor, pageSize, ctx.secret);
  const timezone = 'Australia/Sydney (AEST UTC+10 / AEDT UTC+11 — daylight saving applied per date)';
  if (a.kind === 'recurring_projected') {
    const plans = await readOne(ctx.db, `SELECT * FROM recurring_jobs WHERE ${NOT_LARP()} AND active = true AND created_at <= $1 ORDER BY id`, [start.asOf]);
    const visits: Record<string, unknown>[] = [];
    for (const p of plans) {
      let d = String(p.next_date ?? '');
      for (let i = 0; i < 1000 && isIsoDate(d) && d <= a.to; i++) {
        if (d >= a.from) visits.push({ date: d, preferredTime: p.preferred_time ?? null, projected: true, plan: toRecord(p) });
        const next = advanceDate(d, p.frequency as RecurringFrequency, p.custom_interval_weeks == null ? null : Number(p.custom_interval_weeks));
        if (next <= d) break;
        d = next;
      }
    }
    visits.sort((x, y) => String(x.date).localeCompare(String(y.date)));
    return { timezone, note: 'Projected from active recurring plans (nextDate + frequency). These are NOT booked yet — the daily cron creates the booking on the day (when recurringAutoBookEnabled is on).', ...pageArray(visits, start, ctx.secret) };
  }

  const w = new Where();
  w.add(NOT_LARP()).add('deleted_at IS NULL').add(`created_at <= ${w.p(start.asOf)}`);
  if (!a.includeCancelled) w.add(`status <> 'cancelled'`);
  if (a.assignedGuestId) w.add(`assigned_guest_id = ${w.p(a.assignedGuestId)}`);
  let order: string;
  if (a.kind === 'requested_unscheduled') {
    w.add('scheduled_at IS NULL').add(`preferred_date ~ '^\\d{4}-\\d{2}-\\d{2}$'`)
      .add(`preferred_date >= ${w.p(a.from)}`).add(`preferred_date <= ${w.p(a.to)}`);
    if (!a.includeCancelled) w.add(`status NOT IN ('completed')`);
    order = 'preferred_date ASC, created_at ASC, id ASC';
  } else {
    w.add(`scheduled_at >= ${sydneyDayStartSql(w.p(a.from))}`).add(`scheduled_at < ${sydneyDayEndSql(w.p(a.to))}`);
    if (a.visitType === 'jobs') w.add(`NOT (status = ANY(${w.p(QUOTE_VISIT_STATUSES)}::text[]))`);
    if (a.visitType === 'quote_visits') w.add(`status = ANY(${w.p(QUOTE_VISIT_STATUSES)}::text[])`);
    order = 'scheduled_at ASC, id ASC';
  }
  const [countRows, rows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM bookings ${w.sql()}`, params: w.params },
    { text: `SELECT * FROM bookings ${w.sql()} ORDER BY ${order} LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
  ]);
  const items = rows.map(r => {
    const b = bookingRecord(r, ctx);
    const c = b.computed as Record<string, unknown>;
    return { visitType: c.visitType ?? 'requested_date_only', start: c.scheduledStartSydney ?? null, end: c.scheduledEndSydney ?? null, booking: b };
  });
  return {
    timezone,
    note: a.kind === 'requested_unscheduled'
      ? 'Bookings with a customer-requested preferredDate in range but no calendar slot yet. Non-date preferredDate values (e.g. "ASAP") cannot be range-filtered; find them with search_bookings isScheduled=false.'
      : 'Calendar slots (bookings.scheduledAt). Quote visit = status uncontacted/contacted/quote-booked; anything else = job (same rule as the admin calendar). scheduledEnd null means no explicit end time was set.',
    ...buildPage(items, Number(countRows[0]?.n ?? 0), start, ctx.secret),
  };
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

export interface QuoteFilters {
  query?: string; bookingId?: string; status?: string[];
  quoteDateFrom?: string; quoteDateTo?: string; expired?: boolean;
}

export async function listQuotes(ctx: Ctx, f: QuoteFilters, cursor?: string, pageSize?: number) {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const w = new Where();
  w.add(`q.booking_id NOT LIKE 'LARP-%'`).add(`q.created_at <= ${w.p(start.asOf)}`);
  if (f.bookingId) w.add(`q.booking_id = ${w.p(f.bookingId)}`);
  if (f.status?.length) w.add(`q.status = ANY(${w.p(f.status)}::text[])`);
  if (f.quoteDateFrom) w.add(`q.quote_date >= ${w.p(f.quoteDateFrom)}`);
  if (f.quoteDateTo) w.add(`q.quote_date <= ${w.p(f.quoteDateTo)}`);
  if (f.expired !== undefined) w.add(`(q.valid_until ~ '^\\d{4}-\\d{2}-\\d{2}$' AND q.valid_until ${f.expired ? '<' : '>='} ${w.p(sydneyToday())})`);
  if (f.query) {
    for (const term of f.query.trim().split(/\s+/).slice(0, 8)) {
      const ph = w.p(contains(term));
      w.add(`(${['q.number', 'q.bill_to_name', 'q.bill_to_address', 'q.scope', 'q.notes', 'q.assumptions', 'q.other_lines', 'q.id', 'b.name', 'b.phone', 'b.email']
        .map(c => `coalesce(${c}, '') ILIKE ${ph} ESCAPE '\\'`).join(' OR ')})`);
    }
  }
  const from = `FROM quotes q LEFT JOIN bookings b ON b.id = q.booking_id ${w.sql()}`;
  const [countRows, rows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n ${from}`, params: w.params },
    { text: `SELECT q.*, b.status AS booking_status_, b.name AS booking_name_ ${from} ORDER BY q.seq DESC LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
  ]);
  const items = rows.map(r => {
    const { booking_status_, booking_name_, ...q } = r;
    return { ...quoteRecord(q, ctx, (booking_status_ as string | null) ?? null), linkedBooking: { id: q.booking_id, name: booking_name_ ?? null, status: booking_status_ ?? null } };
  });
  return buildPage(items, Number(countRows[0]?.n ?? 0), start, ctx.secret);
}

export async function getQuoteFull(ctx: Ctx, idOrNumber: string) {
  const [rows] = await ctx.db.many([{ text: `SELECT * FROM quotes WHERE id = $1 OR number = $1`, params: [idOrNumber] }]);
  const q = rows[0];
  if (!q || isLarpId(String(q.booking_id))) return { error: `No quote found with id or number ${idOrNumber}.` };
  const [bk, activity] = await ctx.db.many([
    { text: `SELECT * FROM bookings WHERE id = $1`, params: [q.booking_id] },
    { text: `SELECT * FROM activity_log WHERE meta LIKE $1 ESCAPE '\\' ORDER BY created_at DESC LIMIT 200`, params: [`%"quoteId":"${likeEscape(String(q.id))}"%`] },
  ]);
  return {
    quote: quoteRecord(q, ctx, bk[0] ? String(bk[0].status) : null),
    linkedBooking: bk[0] ? bookingRecord(bk[0], ctx) : null,
    activityHistory: activity.map(activityRecord),
  };
}

// ─── Invoices & payments ────────────────────────────────────────────────────

export interface InvoiceFilters {
  query?: string; bookingId?: string; status?: string[];
  paymentState?: 'paid' | 'unpaid' | 'overdue' | 'draft' | 'cancelled';
  invoiceDateFrom?: string; invoiceDateTo?: string; dueDateFrom?: string; dueDateTo?: string;
  paidFrom?: string; paidTo?: string; ownerGuestId?: string;
}

export async function listInvoices(ctx: Ctx, f: InvoiceFilters, cursor?: string, pageSize?: number) {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const w = new Where();
  w.add(NOT_LARP()).add(`created_at <= ${w.p(start.asOf)}`);
  if (f.bookingId) { const ph = w.p(f.bookingId); w.add(`(booking_id = ${ph} OR booking_ids LIKE ${BOOKING_ID_PATTERN(ph)})`); }
  if (f.status?.length) w.add(`status = ANY(${w.p(f.status)}::text[])`);
  const today = sydneyToday();
  if (f.paymentState === 'paid') w.add(`status = 'paid'`);
  if (f.paymentState === 'unpaid') w.add(`status IN ('sent', 'draft')`);
  if (f.paymentState === 'draft') w.add(`status = 'draft'`);
  if (f.paymentState === 'cancelled') w.add(`status = 'cancelled'`);
  if (f.paymentState === 'overdue') w.add(`status = 'sent' AND due_date <> '' AND due_date < ${w.p(today)}`);
  if (f.invoiceDateFrom) w.add(`invoice_date >= ${w.p(f.invoiceDateFrom)}`);
  if (f.invoiceDateTo) w.add(`invoice_date <= ${w.p(f.invoiceDateTo)}`);
  if (f.dueDateFrom) w.add(`due_date >= ${w.p(f.dueDateFrom)}`);
  if (f.dueDateTo) w.add(`due_date <= ${w.p(f.dueDateTo)}`);
  dateRange(w, 'paid_at', f.paidFrom, f.paidTo);
  if (f.ownerGuestId) w.add(`owner_guest_id = ${w.p(f.ownerGuestId)}`);
  if (f.query) {
    for (const term of f.query.trim().split(/\s+/).slice(0, 8)) {
      const ph = w.p(contains(term));
      w.add(`(${['number', 'bill_to_name', 'bill_to_lines', 'notes', 'items', 'id', 'client_name', 'client_claim_ref', 'client_file_no']
        .map(c => `coalesce(${c}, '') ILIKE ${ph} ESCAPE '\\'`).join(' OR ')})`);
    }
  }
  const [countRows, rows, settingsRows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM invoices ${w.sql()}`, params: w.params },
    { text: `SELECT * FROM invoices ${w.sql()} ORDER BY seq DESC LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
    { text: `SELECT data FROM app_settings WHERE id = 'global'` },
  ]);
  const surcharge = parseSettings(settingsRows[0]?.data).squareSurchargePercent as number;
  return buildPage(rows.map(r => invoiceRecord(r, ctx, surcharge)), Number(countRows[0]?.n ?? 0), start, ctx.secret);
}

export async function getInvoiceFull(ctx: Ctx, idOrNumber: string) {
  const [rows] = await ctx.db.many([{ text: `SELECT * FROM invoices WHERE (id = $1 OR number = $1) AND ${NOT_LARP()}`, params: [idOrNumber] }]);
  const inv = rows[0];
  if (!inv) return { error: `No invoice found with id or number ${idOrNumber}.` };
  const rec = toRecord(inv);
  const bookingIds = Array.isArray(rec.bookingIds) ? (rec.bookingIds as string[]) : [];
  if (inv.booking_id && !bookingIds.includes(String(inv.booking_id))) bookingIds.push(String(inv.booking_id));
  const [views, activity, bookings, owner, settingsRows] = await ctx.db.many([
    { text: `SELECT * FROM invoice_views WHERE invoice_id = $1 ORDER BY started_at DESC`, params: [inv.id] },
    { text: `SELECT * FROM activity_log WHERE invoice_id = $1 OR meta LIKE $2 ESCAPE '\\' ORDER BY created_at DESC`, params: [inv.id, `%"invoiceId":"${likeEscape(String(inv.id))}"%`] },
    { text: `SELECT * FROM bookings WHERE id = ANY($1::text[])`, params: [bookingIds] },
    { text: `SELECT ${GUEST_COLS} FROM guests WHERE id = $1`, params: [inv.owner_guest_id ?? ''] },
    { text: `SELECT data FROM app_settings WHERE id = 'global'` },
  ]);
  const surcharge = parseSettings(settingsRows[0]?.data).squareSurchargePercent as number;
  const invoice = invoiceRecord(inv, ctx, surcharge);
  const history: Record<string, unknown>[] = [];
  if (inv.sent_at) history.push({ at: normalizeTimestamp(inv.sent_at), event: 'invoice_marked_sent', source: 'invoices.sent_at' });
  for (const b of bookings) {
    if (b.customer_marked_paid_at) history.push({ at: normalizeTimestamp(b.customer_marked_paid_at), event: 'customer_tapped_ive_paid', claimOnly: true, bookingId: b.id, source: 'bookings.customer_marked_paid_at' });
  }
  if (inv.square_paid_at) history.push({ at: normalizeTimestamp(inv.square_paid_at), event: 'square_reported_card_payment', claimOnly: true, squarePaymentId: inv.square_payment_id ?? null, source: 'invoices.square_paid_at' });
  if (inv.paid_at) history.push({ at: normalizeTimestamp(inv.paid_at), event: 'invoice_marked_paid', amount: Number(inv.total), method: inv.payment_method ?? null, source: 'invoices.paid_at' });
  for (const a of activity) {
    if (['invoice.status_changed', 'invoice.customer_marked_paid', 'square.paid', 'invoice.pay_by_card_clicked'].includes(String(a.type))) {
      history.push({ at: normalizeTimestamp(a.created_at), event: `activity:${a.type}`, summary: a.summary, actor: a.actor, source: 'activity_log' });
    }
  }
  history.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return {
    invoice,
    paymentHistory: { note: '"claimOnly" events are the customer\'s or Square\'s claim — only "invoice_marked_paid" means the owner confirmed the money arrived.', events: history },
    viewSessions: views.map(v => toRecord(v)),
    activityHistory: activity.map(activityRecord),
    linkedBookings: bookings.map(b => bookingRecord(b, ctx)),
    linkedBookingIdsNotFound: bookingIds.filter(id => !bookings.some(b => b.id === id)),
    createdByGuest: owner[0] ? toRecord(owner[0]) : null,
  };
}

export async function listPayments(ctx: Ctx, f: { from?: string; to?: string; kinds?: string[] }, cursor?: string, pageSize?: number) {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const [invoices, bookings] = await ctx.db.many([
    { text: `SELECT id, number, total, status, payment_method, paid_at, square_paid_at, square_payment_id, square_order_id, booking_ids, bill_to_name
             FROM invoices WHERE ${NOT_LARP()} AND (paid_at IS NOT NULL OR square_paid_at IS NOT NULL) AND created_at <= $1`, params: [start.asOf] },
    { text: `SELECT id, name, quote_amount, paid, paid_at, completed_at, customer_marked_paid_at, status
             FROM bookings WHERE ${NOT_LARP()} AND deleted_at IS NULL AND (paid = true OR customer_marked_paid_at IS NOT NULL) AND created_at <= $1`, params: [start.asOf] },
  ]);
  const events: Record<string, unknown>[] = [];
  for (const i of invoices) {
    if (i.paid_at) events.push({ kind: 'invoice_paid', at: normalizeTimestamp(i.paid_at), amount: Number(i.total), method: i.payment_method ?? null, invoiceId: i.id, invoiceNumber: i.number, billToName: i.bill_to_name, confirmedByOwner: true });
    if (i.square_paid_at) events.push({ kind: 'square_card_payment_reported', at: normalizeTimestamp(i.square_paid_at), invoiceId: i.id, invoiceNumber: i.number, squarePaymentId: i.square_payment_id ?? null, squareOrderId: i.square_order_id ?? null, confirmedByOwner: i.status === 'paid' });
  }
  for (const b of bookings) {
    if (b.paid) events.push({ kind: 'booking_marked_paid', at: normalizeTimestamp(b.paid_at ?? b.completed_at), atSource: b.paid_at ? 'paidAt' : (b.completed_at ? 'completedAt (paidAt missing — older record)' : 'unknown'), amount: b.quote_amount == null ? null : Number(b.quote_amount), bookingId: b.id, name: b.name, confirmedByOwner: true });
    if (b.customer_marked_paid_at) events.push({ kind: 'customer_tapped_ive_paid', at: normalizeTimestamp(b.customer_marked_paid_at), bookingId: b.id, name: b.name, confirmedByOwner: Boolean(b.paid) });
  }
  const filtered = events.filter(e => {
    if (f.kinds?.length && !f.kinds.includes(String(e.kind))) return false;
    const d = e.at ? toSydney(String(e.at))?.date : null;
    if (f.from && (!d || d < f.from)) return false;
    if (f.to && (!d || d > f.to)) return false;
    return true;
  }).sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')));
  return {
    note: 'There is no payments ledger. Payment events are derived from invoices (paidAt/paymentMethod, Square fields) and bookings (paid/paidAt, customer "I\'ve paid" taps). Dashboard revenue counts bookings marked paid (quoteAmount); invoices are a separate record, so the same job can appear as both a booking_marked_paid and an invoice_paid event.',
    ...pageArray(filtered, start, ctx.secret),
  };
}

// ─── Recurring plans ────────────────────────────────────────────────────────

export async function listRecurringPlans(ctx: Ctx, f: { active?: boolean; query?: string; frequency?: string; nextDateFrom?: string; nextDateTo?: string }, cursor?: string, pageSize?: number) {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const w = new Where();
  w.add(NOT_LARP()).add(`created_at <= ${w.p(start.asOf)}`);
  if (f.active !== undefined) w.add(`active = ${w.p(f.active)}`);
  if (f.frequency) w.add(`frequency = ${w.p(f.frequency)}`);
  if (f.nextDateFrom) w.add(`next_date >= ${w.p(f.nextDateFrom)}`);
  if (f.nextDateTo) w.add(`next_date <= ${w.p(f.nextDateTo)}`);
  if (f.query) {
    for (const term of f.query.trim().split(/\s+/).slice(0, 8)) {
      const ph = w.p(contains(term));
      const ors = ['name', 'email', 'phone', 'address', 'suburb', 'notes', 'id'].map(c => `coalesce(${c}, '') ILIKE ${ph} ESCAPE '\\'`);
      const core = phoneCore(term);
      if (core.length >= 3) ors.push(`${PHONE_CORE_SQL('phone')} LIKE ${w.p(contains(core))} ESCAPE '\\'`);
      w.add(`(${ors.join(' OR ')})`);
    }
  }
  const [countRows, rows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM recurring_jobs ${w.sql()}`, params: w.params },
    { text: `SELECT * FROM recurring_jobs ${w.sql()} ORDER BY next_date ASC, id ASC LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
  ]);
  return buildPage(rows.map(r => planRecord(r)), Number(countRows[0]?.n ?? 0), start, ctx.secret);
}

function planRecord(r: Row): Record<string, unknown> {
  const rec = toRecord(r);
  rec.computed = {
    legacyDiscountColumnNote: rec.discount != null ? 'discount is a retired field (replaced by billingCycle) — kept for history only' : undefined,
    upcomingVisits: projectVisits(r, 6),
  };
  return rec;
}

function projectVisits(p: Row, n: number): string[] {
  const out: string[] = [];
  let d = String(p.next_date ?? '');
  for (let i = 0; i < n && isIsoDate(d); i++) {
    out.push(d);
    const next = advanceDate(d, p.frequency as RecurringFrequency, p.custom_interval_weeks == null ? null : Number(p.custom_interval_weeks));
    if (next <= d) break;
    d = next;
  }
  return out;
}

export async function getRecurringPlanFull(ctx: Ctx, id: string) {
  if (isLarpId(id)) return { error: 'That id belongs to LARP/demo-mode fake data.' };
  const [plan, visits] = await ctx.db.many([
    { text: `SELECT * FROM recurring_jobs WHERE id = $1`, params: [id] },
    { text: `SELECT * FROM bookings WHERE recurring_id = $1 AND ${NOT_LARP()} ORDER BY coalesce(scheduled_at, created_at) DESC`, params: [id] },
  ]);
  if (!plan[0]) return { error: `No recurring plan found with id ${id}.` };
  return { plan: planRecord(plan[0]), generatedBookings: visits.map(b => bookingRecord(b, ctx)) };
}

// ─── Activity ───────────────────────────────────────────────────────────────

export async function listActivity(ctx: Ctx, f: { type?: string; bookingId?: string; invoiceId?: string; quoteId?: string; actor?: string; from?: string; to?: string }, cursor?: string, pageSize?: number) {
  const start = startPage(f, cursor, pageSize, ctx.secret);
  const w = new Where();
  w.add(`created_at <= ${w.p(start.asOf)}`);
  if (f.type) w.add(f.type.endsWith('.') ? `type LIKE ${w.p(`${likeEscape(f.type)}%`)} ESCAPE '\\'` : `type = ${w.p(f.type)}`);
  if (f.bookingId) w.add(`meta LIKE ${w.p(`%"bookingId":"${likeEscape(f.bookingId)}"%`)} ESCAPE '\\'`);
  if (f.invoiceId) w.add(`(invoice_id = ${w.p(f.invoiceId)} OR meta LIKE ${w.p(`%"invoiceId":"${likeEscape(f.invoiceId)}"%`)} ESCAPE '\\')`);
  if (f.quoteId) w.add(`meta LIKE ${w.p(`%"quoteId":"${likeEscape(f.quoteId)}"%`)} ESCAPE '\\'`);
  if (f.actor) w.add(`actor = ${w.p(f.actor)}`);
  dateRange(w, 'created_at', f.from, f.to);
  const [countRows, rows] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM activity_log ${w.sql()}`, params: w.params },
    { text: `SELECT * FROM activity_log ${w.sql()} ORDER BY created_at DESC, id DESC LIMIT ${start.pageSize} OFFSET ${start.offset}`, params: w.params },
  ]);
  return buildPage(rows.map(activityRecord), Number(countRows[0]?.n ?? 0), start, ctx.secret);
}

// ─── Photos ─────────────────────────────────────────────────────────────────

export async function getPhotoLinks(ctx: Ctx, bookingId: string) {
  if (isLarpId(bookingId)) return { error: 'That id belongs to LARP/demo-mode fake data.' };
  const rows = await readOne(ctx.db, `SELECT * FROM booking_photos WHERE booking_id = $1 ORDER BY created_at, id`, [bookingId]);
  return {
    bookingId,
    total: rows.length,
    photos: rows.map(r => photoRecord(r, ctx)),
    note: `Links expire after ${FILE_LINK_TTL_SECONDS / 60} minutes; call again for fresh ones.`,
  };
}

// ─── Settings & business configuration ─────────────────────────────────────

function parseSettings(raw: unknown): Record<string, unknown> {
  let stored: Record<string, unknown> = {};
  if (typeof raw === 'string') { try { stored = JSON.parse(raw); } catch { stored = {}; } }
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function getSettingsObject(ctx: Ctx): Promise<Record<string, unknown>> {
  const rows = await readOne(ctx.db, `SELECT data FROM app_settings WHERE id = 'global'`);
  return parseSettings(rows[0]?.data);
}

export async function getBusinessSettings(ctx: Ctx) {
  const [settingsRows, businessProfiles, paymentProfiles, guests, groups] = await ctx.db.many([
    { text: `SELECT data, updated_at FROM app_settings WHERE id = 'global'` },
    { text: `SELECT * FROM business_profiles ORDER BY sort, id` },
    { text: `SELECT * FROM payment_profiles ORDER BY sort, id` },
    { text: `SELECT ${GUEST_COLS},
               (SELECT count(*)::int FROM bookings b WHERE b.assigned_guest_id = g.id AND b.deleted_at IS NULL AND b.id NOT LIKE 'LARP-%') AS assigned_job_count,
               (SELECT count(*)::int FROM invoices i WHERE i.owner_guest_id = g.id AND i.id NOT LIKE 'LARP-%') AS invoice_count
             FROM guests g ORDER BY created_at` },
    { text: `SELECT g.*, (SELECT count(*)::int FROM bookings b WHERE b.group_id = g.id AND b.deleted_at IS NULL) AS job_count,
               (SELECT coalesce(sum(b.quote_amount), 0) FROM bookings b WHERE b.group_id = g.id AND b.deleted_at IS NULL) AS total_value
             FROM booking_groups g ORDER BY created_at DESC` },
  ]);
  const storedRaw = settingsRows[0]?.data;
  let stored: Record<string, unknown> | null = null;
  if (typeof storedRaw === 'string') { try { stored = JSON.parse(storedRaw); } catch { stored = null; } }
  const unknownKeys = stored ? Object.keys(stored).filter(k => !(k in DEFAULT_SETTINGS)) : [];
  return {
    appSettings: parseSettings(storedRaw),
    appSettingsMeta: {
      storedRowExists: Boolean(settingsRows[0]),
      updatedAt: normalizeTimestamp(settingsRows[0]?.updated_at),
      keysUsingDefaults: stored ? Object.keys(DEFAULT_SETTINGS).filter(k => !(k in stored!)) : Object.keys(DEFAULT_SETTINGS),
      storedKeysNoLongerUsed: unknownKeys,
    },
    businessProfiles: businessProfiles.map(r => toRecord(r)),
    paymentProfiles: paymentProfiles.map(r => toRecord(r)),
    subcontractorGuestLogins: guests.map(r => toRecord(r)),
    bookingGroups: groups.map(r => toRecord(r)),
    excluded: {
      vault: 'Vault items (Settings → Vault) are a store for secrets and are deliberately not accessible.',
      guestPasswords: 'Guest password hashes are never accessible.',
      environmentSecrets: 'API keys, database credentials, admin password and session secrets live in server environment variables and are never exposed.',
    },
  };
}

// ─── Facebook lead sync status ──────────────────────────────────────────────

export async function getFacebookLeadStatus(ctx: Ctx) {
  const [counts, latest, dismissed] = await ctx.db.many([
    { text: `SELECT status, count(*)::int AS n, max(created_at) AS latest FROM bookings
             WHERE source = 'facebook-lead-ad' AND deleted_at IS NULL AND ${NOT_LARP()} GROUP BY status` },
    { text: `SELECT id, name, status, suburb, created_at, external_lead_id FROM bookings
             WHERE source = 'facebook-lead-ad' AND ${NOT_LARP()} ORDER BY created_at DESC LIMIT 10` },
    { text: `SELECT count(*)::int AS n, max(dismissed_at) AS latest FROM dismissed_leads` },
  ]);
  const total = counts.reduce((s, r) => s + Number(r.n), 0);
  const lastImport = counts.reduce<string | null>((m, r) => {
    const t = normalizeTimestamp(r.latest);
    return t && (!m || t > m) ? t : m;
  }, null);
  return {
    configured: {
      sheetIdSet: Boolean(process.env.META_LEADS_SHEET_ID),
      googleServiceAccountSet: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      cronSecretSetOnServer: Boolean(process.env.CRON_SECRET),
    },
    schedule: 'GitHub Actions every 5 minutes (.github/workflows/meta-leads-sync.yml, needs the CRON_SECRET repo secret), Vercel Cron daily 22:00 UTC as a backstop, plus a check every 60s while the admin Bookings tab is open.',
    importedLeads: { totalNotDeleted: total, byStatus: Object.fromEntries(counts.map(r => [r.status, Number(r.n)])), mostRecentImportAt: lastImport, mostRecentImportSydney: toSydney(lastImport) },
    recentImports: latest.map(r => toRecord(r)),
    dismissedLeads: { count: Number(dismissed[0]?.n ?? 0), lastDismissedAt: normalizeTimestamp(dismissed[0]?.latest), note: 'Leads deleted from the CRM are remembered here so the sheet poll never re-imports them.' },
    limitations: 'Individual sync runs are not recorded anywhere, so there is no last-run time or run error history. "mostRecentImportAt" is the newest imported lead, not the last poll. Use checkSheet=true to compare the Google Sheet against imported leads right now.',
  };
}

// Live, read-only comparison of the Meta lead Google Sheet against imported
// bookings — finds rows that haven't been imported yet. Never writes to the
// sheet or the database.
export async function checkLeadSheet(ctx: Ctx) {
  const sheetId = process.env.META_LEADS_SHEET_ID;
  if (!sheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return { available: false, reason: 'Google Sheet sync is not configured on this server.' };
  const { listSheetTabs, fetchSheetRows } = await import('../googleSheets');
  const { mapSheetRowToBooking } = await import('../metaLeads');
  const [imported, dismissed] = await ctx.db.many([
    { text: `SELECT external_lead_id FROM bookings WHERE external_lead_id IS NOT NULL` },
    { text: `SELECT external_lead_id FROM dismissed_leads` },
  ]);
  const importedIds = new Set(imported.map(r => String(r.external_lead_id)));
  const dismissedIds = new Set(dismissed.map(r => String(r.external_lead_id)));
  const tabs = await listSheetTabs(sheetId);
  const perTab: Record<string, unknown>[] = [];
  const notImported: Record<string, unknown>[] = [];
  for (const tab of tabs) {
    let rows: string[][] = [];
    try { rows = await fetchSheetRows(sheetId, tab, process.env.META_LEADS_SHEET_RANGE || 'A:Z'); }
    catch { perTab.push({ tab, error: 'could not read this tab' }); continue; }
    const [header, ...data] = rows;
    let leadRows = 0, alreadyImported = 0, dismissedCount = 0;
    for (const row of data) {
      if (!header || !row.some(c => c && c.trim())) continue;
      leadRows++;
      const m = mapSheetRowToBooking(header, row, tab);
      if (importedIds.has(m.externalLeadId)) alreadyImported++;
      else if (dismissedIds.has(m.externalLeadId)) dismissedCount++;
      else notImported.push({ tab, externalLeadId: m.externalLeadId, name: m.name, suburb: m.suburb });
    }
    perTab.push({ tab, leadRows, alreadyImported, dismissed: dismissedCount, notYetImported: leadRows - alreadyImported - dismissedCount });
  }
  return { available: true, checkedAt: new Date().toISOString(), tabs: perTab, notYetImported: notImported };
}

// ─── Reports ────────────────────────────────────────────────────────────────

async function loadReportData(ctx: Ctx) {
  const [bookings, invoices, quotes] = await ctx.db.many([
    { text: `SELECT * FROM bookings WHERE ${NOT_LARP()} AND deleted_at IS NULL` },
    { text: `SELECT * FROM invoices WHERE ${NOT_LARP()}` },
    { text: `SELECT id, booking_id, status, amount, quote_date, sent_at FROM quotes WHERE booking_id NOT LIKE 'LARP-%'` },
  ]);
  return { bookings, invoices, quotes };
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

export async function report(ctx: Ctx, name: string, opts: { days?: number; months?: number }, cursor?: string, pageSize?: number) {
  if (name === 'site_traffic') return siteTraffic(ctx, Math.min(365, Math.max(1, opts.days ?? 30)));
  const { bookings, invoices, quotes } = await loadReportData(ctx);
  const today = sydneyToday();
  const thisMonth = today.slice(0, 7);

  if (name === 'overview') {
    const status: Record<string, number> = Object.fromEntries(BOOKING_STATUSES.map(s => [s, 0]));
    bookings.forEach(b => { status[String(b.status)] = (status[String(b.status)] ?? 0) + 1; });
    const quoted = bookings.filter(b => num(b.quote_amount) > 0);
    const paid = bookings.filter(b => b.paid && b.quote_amount != null);
    const owed = bookings.filter(b => !b.paid && b.status === 'completed' && num(b.quote_amount) > 0);
    const paidThisMonth = paid.filter(b => { const t = normalizeTimestamp(b.paid_at ?? b.completed_at); return t && sydneyMonthKey(t) === thisMonth; });
    const now = new Date().toISOString();
    const upcoming = bookings.filter(b => b.scheduled_at && normalizeTimestamp(b.scheduled_at)! > now && b.status !== 'cancelled');
    return {
      definitions: 'Same rules as the admin Dashboard overview: revenue = bookings marked paid (sum of quoteAmount, by paidAt, falling back to completedAt); owed = completed + unpaid bookings with a quote amount. Months are Sydney calendar months.',
      totalLeads: bookings.length,
      leadsThisMonth: bookings.filter(b => sydneyMonthKey(normalizeTimestamp(b.created_at)!) === thisMonth).length,
      statusCounts: status,
      quoted: { count: quoted.length, value: quoted.reduce((s, b) => s + num(b.quote_amount), 0) },
      revenue: { total: paid.reduce((s, b) => s + num(b.quote_amount), 0), thisMonth: paidThisMonth.reduce((s, b) => s + num(b.quote_amount), 0) },
      owed: { count: owed.length, value: owed.reduce((s, b) => s + num(b.quote_amount), 0) },
      upcoming: {
        jobs: upcoming.filter(b => !QUOTE_VISIT_STATUSES.includes(String(b.status))).length,
        quoteVisits: upcoming.filter(b => QUOTE_VISIT_STATUSES.includes(String(b.status))).length,
      },
      leadsByMonth: monthSeries(bookings.map(b => normalizeTimestamp(b.created_at)!), opts.months ?? 12).map(([month, count]) => ({ month, count })),
    };
  }

  if (name === 'business') {
    const total = bookings.length;
    const completed = bookings.filter(b => b.status === 'completed').length;
    const withQuote = bookings.filter(b => num(b.quote_amount) > 0);
    const tally = (key: (b: Row) => string | null) => {
      const m: Record<string, number> = {};
      bookings.forEach(b => { const k = key(b); if (k) m[k] = (m[k] ?? 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n }));
    };
    const rated = bookings.filter(b => b.feedback_stars != null);
    const debtor = invoices.map(i => debtorDays({ sentAt: normalizeTimestamp(i.sent_at), paidAt: normalizeTimestamp(i.paid_at) })).filter((d): d is number => d != null);
    const overdue = invoices.filter(i => isInvoiceOverdue({ status: i.status as 'sent', dueDate: String(i.due_date ?? '') }));
    return {
      totalLeads: total,
      completedJobs: completed,
      conversionRatePercent: total ? Math.round((completed / total) * 100) : 0,
      averageQuote: withQuote.length ? Math.round(withQuote.reduce((s, b) => s + num(b.quote_amount), 0) / withQuote.length) : null,
      leadsBySource: tally(b => String(b.source ?? 'website')),
      manualLeadSources: tally(b => (b.lead_source as string | null) ?? null),
      websiteAttribution: tally(b => (b.source === 'website' ? (b.attribution_source as string | null) : null)),
      suburbs: tally(b => String(b.suburb ?? '').trim() || null),
      services: (() => {
        const m: Record<string, number> = {};
        bookings.forEach(b => String(b.service ?? '').split(',').filter(Boolean).forEach(s => { m[s] = (m[s] ?? 0) + 1; }));
        return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ service: k, label: BOOKING_SERVICE_LABELS[k] ?? k, count: n }));
      })(),
      customerFeedback: { ratedJobs: rated.length, averageStars: rated.length ? Math.round((rated.reduce((s, b) => s + num(b.feedback_stars), 0) / rated.length) * 10) / 10 : null },
      invoices: {
        count: invoices.length,
        averageDebtorDays: debtor.length ? Math.round(debtor.reduce((a, b) => a + b, 0) / debtor.length) : null,
        overdueCount: overdue.length,
        overdueValue: overdue.reduce((s, i) => s + num(i.total), 0),
      },
      quoteDocuments: { count: quotes.length, sent: quotes.filter(q => q.status === 'sent').length, drafts: quotes.filter(q => q.status === 'draft').length },
    };
  }

  if (name === 'revenue_by_month') {
    const months = Math.min(60, Math.max(1, opts.months ?? 12));
    const byBooking: Record<string, number> = {};
    bookings.filter(b => b.paid && b.quote_amount != null).forEach(b => {
      const t = normalizeTimestamp(b.paid_at ?? b.completed_at); const k = t ? sydneyMonthKey(t) : 'unknown_date';
      byBooking[k!] = (byBooking[k!] ?? 0) + num(b.quote_amount);
    });
    const byInvoice: Record<string, number> = {};
    invoices.filter(i => i.status === 'paid').forEach(i => {
      const t = normalizeTimestamp(i.paid_at); const k = t ? sydneyMonthKey(t) : 'unknown_date';
      byInvoice[k!] = (byInvoice[k!] ?? 0) + num(i.total);
    });
    const keys = monthSeries([], months).map(([m]) => m);
    return {
      definitions: 'bookingsPaid = admin dashboard revenue (bookings marked paid, quoteAmount, by paidAt or completedAt). invoicesPaid = invoices with status paid, by paidAt. They overlap when a paid job also has a paid invoice — do not add them together.',
      months: keys.map(m => ({ month: m, bookingsPaid: byBooking[m] ?? 0, invoicesPaid: byInvoice[m] ?? 0 })),
      outsideRange: { bookingsPaidUnknownDate: byBooking.unknown_date ?? 0, invoicesPaidUnknownDate: byInvoice.unknown_date ?? 0 },
    };
  }

  if (name === 'pipeline') {
    const by = (s: string) => bookings.filter(b => b.status === s);
    return {
      stages: BOOKING_STATUSES.map(s => ({ status: s, count: by(s).length, quotedValue: by(s).reduce((t, b) => t + num(b.quote_amount), 0) })),
      autoMovedByStaleLeadJob: bookings.filter(b => b.auto_moved).map(b => ({ id: b.id, name: b.name, status: b.status, from: b.auto_moved_from, at: normalizeTimestamp(b.auto_moved_at) })),
      flaggedJobs: bookings.filter(b => b.flagged_at).map(b => ({ id: b.id, name: b.name, status: b.status, flaggedAt: normalizeTimestamp(b.flagged_at), flagNote: b.flag_note })),
    };
  }

  if (name === 'quoted_not_booked') {
    const sentQuoteBookings = new Set(quotes.filter(q => q.status === 'sent').map(q => String(q.booking_id)));
    const anyQuoteBookings = new Set(quotes.map(q => String(q.booking_id)));
    const rows = bookings.filter(b => {
      const s = String(b.status);
      if (['confirmed', 'completed', 'cancelled'].includes(s)) return false;
      return s === 'quoted' || sentQuoteBookings.has(String(b.id)) || (s === 'cold' && (num(b.quote_amount) > 0 || anyQuoteBookings.has(String(b.id))));
    }).sort((a, b) => String(normalizeTimestamp(a.quoted_at ?? a.updated_at)).localeCompare(String(normalizeTimestamp(b.quoted_at ?? b.updated_at))));
    const start = startPage({ name }, cursor, pageSize, ctx.secret);
    const items = rows.map(b => {
      const rec = bookingRecord(b, ctx);
      const qAt = normalizeTimestamp(b.quoted_at);
      return {
        reason: b.status === 'quoted' ? 'status is quoted (quote given, not yet confirmed)' : b.status === 'cold' ? 'went cold after being quoted' : 'a quote document was sent but the booking has not progressed',
        daysSinceQuoted: qAt ? daysBetween(toSydney(qAt)!.date, today) : null,
        quoteDocuments: quotes.filter(q => q.booking_id === b.id).map(q => ({ id: q.id, status: q.status, amount: num(q.amount), quoteDate: q.quote_date })),
        booking: rec,
      };
    });
    return {
      definition: 'Bookings that have been quoted (status "quoted", or a quote document sent, or status "cold" with a quote) but are not confirmed, completed or cancelled. Oldest quotes first.',
      ...pageArray(items, start, ctx.secret),
    };
  }

  if (name === 'owed') {
    const start = startPage({ name }, cursor, pageSize, ctx.secret);
    const items: Record<string, unknown>[] = [
      ...bookings.filter(b => !b.paid && b.status === 'completed' && num(b.quote_amount) > 0)
        .map(b => ({ kind: 'completed_unpaid_booking', amount: num(b.quote_amount), booking: bookingRecord(b, ctx) })),
      ...invoices.filter(i => i.status === 'sent')
        .map(i => ({ kind: 'unpaid_sent_invoice', amount: num(i.total), invoice: invoiceRecord(i, ctx) })),
    ];
    return {
      definition: 'completed_unpaid_booking = the dashboard "Owed" list. unpaid_sent_invoice = invoices sent but not marked paid. The same job can appear in both.',
      ...pageArray(items, start, ctx.secret),
    };
  }

  return { error: `Unknown report ${name}` };
}

function monthSeries(isoDates: string[], months: number): [string, number][] {
  const now = sydneyToday();
  let y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  const counts = Object.fromEntries(keys.map(k => [k, 0]));
  isoDates.forEach(d => { const k = d ? sydneyMonthKey(d) : null; if (k && k in counts) counts[k]++; });
  return keys.map(k => [k, counts[k]]);
}

async function siteTraffic(ctx: Ctx, days: number) {
  const [views, funnel, allTime] = await ctx.db.many([
    { text: `SELECT path, referrer, visitor, view_id, max_scroll_percent, duration_seconds, created_at FROM pageviews
             WHERE created_at >= now() - ($1 || ' days')::interval AND visitor NOT LIKE 'larp\\_%' ESCAPE '\\'`, params: [String(days)] },
    { text: `SELECT visitor, step, submitted, created_at FROM booking_funnel_events WHERE created_at >= now() - ($1 || ' days')::interval`, params: [String(days)] },
    { text: `SELECT count(*)::int AS n FROM pageviews WHERE visitor NOT LIKE 'larp\\_%' ESCAPE '\\'` },
  ]);
  const v = views.map(r => ({ path: String(r.path), referrer: String(r.referrer ?? ''), visitor: String(r.visitor ?? ''), maxScrollPercent: r.max_scroll_percent == null ? null : Number(r.max_scroll_percent), durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds), createdAt: normalizeTimestamp(r.created_at)! }));
  const pageCounts: Record<string, number> = {};
  v.forEach(x => { pageCounts[x.path] = (pageCounts[x.path] ?? 0) + 1; });
  const ranked = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).map(([path, n]) => ({ path, views: n }));
  const refCounts: Record<string, number> = {};
  v.forEach(x => { const r = x.referrer || '(direct / none)'; refCounts[r] = (refCounts[r] ?? 0) + 1; });
  const byDay: Record<string, number> = {};
  v.forEach(x => { const d = toSydney(x.createdAt)!.date; byDay[d] = (byDay[d] ?? 0) + 1; });
  const f = funnel.map(r => ({ visitor: String(r.visitor), step: String(r.step), submitted: Boolean(r.submitted), createdAt: normalizeTimestamp(r.created_at)! }));
  return {
    days,
    privacy: 'Visitors are daily anonymous hashes — no IP addresses or identities are stored for site traffic.',
    pageViews: v.length,
    pageViewsAllTime: Number(allTime[0]?.n ?? 0),
    uniqueVisitorDays: new Set(v.map(x => x.visitor).filter(Boolean)).size,
    viewsBySydneyDay: Object.entries(byDay).sort().map(([date, views]) => ({ date, views })),
    pages: computePageEngagement(v, ranked),
    referrers: Object.entries(refCounts).sort((a, b) => b[1] - a[1]).map(([referrer, n]) => ({ referrer, views: n })),
    scroll: computeScrollBuckets(v),
    time: computeSiteWideTimeStats(v),
    bookingFormFunnel: computeBookingFunnel(f),
  };
}

// ─── Cross-entity search (for finding/disambiguating a person) ─────────────

export async function searchEverything(ctx: Ctx, query: string) {
  const PER = 10;
  const bw = bookingWhere({ query, deleted: 'include' }, null);
  const rw = new Where(); rw.add(NOT_LARP());
  const iw = new Where(); iw.add(NOT_LARP());
  const qw = new Where(); qw.add(`booking_id NOT LIKE 'LARP-%'`);
  for (const term of query.trim().split(/\s+/).slice(0, 8)) {
    const rp = rw.p(contains(term));
    rw.add(`(${['name', 'email', 'phone', 'address', 'suburb', 'notes', 'id'].map(c => `coalesce(${c}, '') ILIKE ${rp} ESCAPE '\\'`).join(' OR ')})`);
    const ip = iw.p(contains(term));
    iw.add(`(${['number', 'bill_to_name', 'bill_to_lines', 'notes', 'items', 'id'].map(c => `coalesce(${c}, '') ILIKE ${ip} ESCAPE '\\'`).join(' OR ')})`);
    const qp = qw.p(contains(term));
    qw.add(`(${['number', 'bill_to_name', 'bill_to_address', 'scope', 'notes', 'id'].map(c => `coalesce(${c}, '') ILIKE ${qp} ESCAPE '\\'`).join(' OR ')})`);
  }
  const [bc, br, rc, rr, ic, ir, qc, qr] = await ctx.db.many([
    { text: `SELECT count(*)::int AS n FROM bookings ${bw.sql()}`, params: bw.params },
    { text: `SELECT id, name, phone, email, suburb, address, status, source, created_at, deleted_at FROM bookings ${bw.sql()} ORDER BY created_at DESC LIMIT ${PER}`, params: bw.params },
    { text: `SELECT count(*)::int AS n FROM recurring_jobs ${rw.sql()}`, params: rw.params },
    { text: `SELECT id, name, phone, suburb, address, frequency, active, next_date FROM recurring_jobs ${rw.sql()} ORDER BY name LIMIT ${PER}`, params: rw.params },
    { text: `SELECT count(*)::int AS n FROM invoices ${iw.sql()}`, params: iw.params },
    { text: `SELECT id, number, bill_to_name, status, total, invoice_date FROM invoices ${iw.sql()} ORDER BY seq DESC LIMIT ${PER}`, params: iw.params },
    { text: `SELECT count(*)::int AS n FROM quotes ${qw.sql()}`, params: qw.params },
    { text: `SELECT id, number, booking_id, bill_to_name, status, amount, quote_date FROM quotes ${qw.sql()} ORDER BY seq DESC LIMIT ${PER}`, params: qw.params },
  ]);
  const section = (c: Row[], r: Row[], tool: string) => {
    const total = Number(c[0]?.n ?? 0);
    return { total, returned: r.length, moreAvailable: total > r.length, getAllWith: tool, items: r.map(x => toRecord(x)) };
  };
  return {
    query,
    bookings: section(bc, br, 'search_bookings with query'),
    recurringPlans: section(rc, rr, 'list_recurring_plans with query'),
    invoices: section(ic, ir, 'list_invoices with query'),
    quotes: section(qc, qr, 'list_quotes with query'),
    note: 'Each section shows up to 10 matches. If more than one PERSON matches, ask the user which one (show name, suburb, phone) before acting on a single record.',
  };
}
