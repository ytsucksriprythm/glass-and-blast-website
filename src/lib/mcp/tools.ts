// The MCP tool surface for ChatGPT. READ-ONLY: every tool here only calls
// read functions in ./data (which run on the read-only role inside READ ONLY
// transactions). There are no write tools — proposed ones are documented in
// docs/mcp-write-tools-proposal.md and deliberately NOT registered.
//
// Every call is input-validated (zod), rate-limited per authorized client,
// and audited (tool, sanitized arguments, result count, timing — free-text
// search terms are hashed, never logged; no tokens/secrets).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { McpConfig } from './config';
import { audit, countEvents } from './authStore';
import { sha256Hex } from './crypto';
import { getReadDb, assertReadOnlyRole, ReadOnlyViolation } from './sql';
import { CursorError } from './records';
import { isIsoDate, daysBetween } from './time';
import * as data from './data';
import { TABLE_COVERAGE, EXCLUDED_TABLES, ADMIN_SECTIONS, KNOWN_GAPS, DATA_CONVENTIONS } from './coverage';

export interface CallerInfo { clientId: string; tokenId: string; ip: string }

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

// ─── Input schemas ──────────────────────────────────────────────────────────

const date = z.string().refine(isIsoDate, 'Use a real calendar date in YYYY-MM-DD format (Australia/Sydney).');
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid id format');
const text = (max = 200) => z.string().trim().min(1).max(max);
const page = {
  pageSize: z.number().int().min(1).max(100).optional().describe('Records per page (default 25, max 100).'),
  cursor: z.string().max(2000).optional().describe('nextCursor from the previous page. Pass the SAME filters as the first call.'),
};
const bookingStatus = z.enum(data.BOOKING_STATUSES);
const bookingSource = z.enum(data.BOOKING_SOURCES);
const leadSource = z.enum(['called-us', 'we-called', 'door-to-door', 'in-person', 'real-estate', 'other']);

const FREE_TEXT_KEYS = new Set(['query', 'name', 'phone', 'email', 'address', 'suburb', 'notesContains', 'attributionSource']);

function sanitizeForAudit(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === 'cursor') { out[k] = v ? 'present' : undefined; continue; }
    if (FREE_TEXT_KEYS.has(k) && typeof v === 'string') { out[k] = { len: v.length, sha256: sha256Hex(v.toLowerCase()).slice(0, 12) }; continue; }
    out[k] = v;
  }
  return out;
}

function countResults(result: unknown): number {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.items)) return r.items.length;
    if ('error' in r) return 0;
  }
  return 1;
}

function ok(result: unknown): CallToolResult {
  const obj = (result && typeof result === 'object' && !Array.isArray(result)) ? result as Record<string, unknown> : { result };
  if ('error' in obj && Object.keys(obj).length === 1) {
    return { content: [{ type: 'text', text: String(obj.error) }], isError: true };
  }
  return { content: [{ type: 'text', text: JSON.stringify(obj) }], structuredContent: obj };
}
function fail(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Server factory ─────────────────────────────────────────────────────────

export function buildMcpServer(cfg: McpConfig, caller: CallerInfo): McpServer {
  const server = new McpServer(
    { name: 'glass-and-blast-business', version: '1.0.0' },
    {
      instructions:
        'Read-only access to ALL Glass & Blast Window Cleaning business records (Canberra, Australia): customers/leads/jobs ' +
        '(bookings), quotes, invoices, payments, recurring plans, notes, history, photos, settings and reports. Nothing can be changed. ' +
        `${DATA_CONVENTIONS.pagination} ${DATA_CONVENTIONS.nullVsEmpty} ${DATA_CONVENTIONS.dateFilters} ` +
        'When a name matches more than one person, show the candidates (name, suburb, phone, id) and ask which one before answering about "the" customer. ' +
        'Call describe_data_coverage to see exactly what is and is not available.',
    },
  );
  const ctx: data.Ctx = { db: getReadDb(cfg.readDatabaseUrl), baseUrl: cfg.baseUrl, secret: cfg.tokenSecret };

  function tool<S extends z.ZodRawShape>(
    name: string, title: string, description: string, inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(name, { title, description, inputSchema, annotations: { title, ...READ_ONLY } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (args: any): Promise<CallToolResult> => {
        const started = Date.now();
        const base = { clientId: caller.clientId, tokenId: caller.tokenId, ip: caller.ip, tool: name };
        try {
          const recent = await countEvents('tool_call', 600, { clientId: caller.clientId });
          if (recent >= cfg.toolCallsPer10Min) {
            await audit({ ...base, event: 'rate_limited', ok: false });
            return fail(`Rate limit reached (${cfg.toolCallsPer10Min} tool calls per 10 minutes). Wait a few minutes and continue.`);
          }
          await assertReadOnlyRole(ctx.db);
          const result = await handler(args);
          await audit({ ...base, event: 'tool_call', ok: true, detail: sanitizeForAudit(args), resultCount: countResults(result), durationMs: Date.now() - started });
          return ok(result);
        } catch (err) {
          const isCursor = err instanceof CursorError;
          await audit({ ...base, event: 'tool_call', ok: false, detail: { ...sanitizeForAudit(args), error: isCursor ? 'cursor' : err instanceof ReadOnlyViolation ? 'read_only_check_failed' : 'internal' }, durationMs: Date.now() - started });
          if (isCursor) return fail(err.message);
          // Details go to server logs only — never to the client.
          console.error(`[mcp] ${name} failed:`, err instanceof Error ? err.message : 'unknown error');
          if (err instanceof ReadOnlyViolation) return fail('The connector is temporarily unavailable (database safety check failed). The owner has been notified in the server logs.');
          return fail('Something went wrong reading the data. Try again, or narrow the request.');
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
  }

  // ── Finding records ──────────────────────────────────────────────────────

  tool('search_everything', 'Search all records',
    'Quick search across bookings (customers/leads/jobs), recurring plans, invoices and quotes at once — use this first to find or disambiguate a person by name, phone, email, address or suburb. Returns totals per type and up to 10 matches each, with the exact tool to page through the rest.',
    { query: text(200).describe('Name, phone, email, address, suburb, invoice/quote number or any text') },
    ({ query }) => data.searchEverything(ctx, query));

  tool('search_bookings', 'Search customers, leads & jobs',
    'Search and list bookings — every customer, lead, quote visit and job is a booking. Filter by any combination below; all text filters are case-insensitive partial matches and `query` matches every word across name, phone, email, address, suburb, notes, private admin notes and ids. Returns FULL records (all fields incl. notes and adminNotes) with total count and nextCursor — keep paging until hasMore is false for complete results.',
    {
      query: text().optional(), name: text().optional(),
      phone: z.string().trim().regex(/\d.*\d.*\d/, 'Phone needs at least 3 digits').max(30).optional().describe('Any format; matched on digits ignoring +61/0'),
      email: text().optional(), address: text().optional(), suburb: text().optional(),
      notesContains: text().optional().describe('Match inside customer notes, private admin notes or flag notes'),
      ids: z.array(id).max(100).optional(),
      status: z.array(bookingStatus).max(8).optional(),
      source: z.array(bookingSource).max(3).optional().describe('How the lead arrived: website form, manual entry, facebook-lead-ad'),
      leadSource: z.array(leadSource).max(6).optional().describe('Manual-entry lead source'),
      attributionSource: text(100).optional().describe('Website attribution, e.g. "Facebook", "Google Maps"'),
      service: z.enum(['window-washing', 'pressure-washing', 'flyscreen-repair', 'solar-panel-cleaning', 'other', 'both']).optional(),
      propertyType: z.enum(['residential', 'commercial']).optional(),
      createdFrom: date.optional().describe('Date received, from (Sydney date, inclusive)'), createdTo: date.optional(),
      scheduledFrom: date.optional(), scheduledTo: date.optional(),
      completedFrom: date.optional(), completedTo: date.optional(),
      updatedFrom: date.optional(), updatedTo: date.optional(),
      preferredDateFrom: date.optional().describe("Customer's requested date (only rows where it's a real date)"), preferredDateTo: date.optional(),
      paid: z.boolean().optional(), hasQuoteAmount: z.boolean().optional(), isScheduled: z.boolean().optional(), flagged: z.boolean().optional(),
      assignedGuestId: id.optional(), recurringId: id.optional(), groupId: id.optional(),
      deleted: z.enum(['exclude', 'include', 'only']).optional().describe('Soft-deleted bookings (60-day trash). Default exclude.'),
      sort: z.enum(['created_desc', 'created_asc', 'updated_desc', 'scheduled_asc', 'scheduled_desc', 'name_asc']).optional(),
      ...page,
    },
    ({ cursor, pageSize, ...filters }) => data.searchBookings(ctx, filters, cursor, pageSize));

  tool('get_booking', 'Get complete booking / customer record',
    'Everything about one booking by its id (BK-…): every stored field (contact details, full address, service, status, quote amount, preferred date/time, customer notes, private admin notes, flags, feedback, payment and completion dates, assignment, calendar slot in Sydney time) PLUS all linked records: quotes (with line items/discounts), invoices (with payment status), photos (short-lived links), recurring plan, group, assigned subcontractor, other bookings for the same customer, and the full activity history.',
    { id },
    ({ id }) => data.getBookingFull(ctx, id));

  tool('get_customer_history', 'Get customer history',
    'All records for one customer across time: bookings, recurring plans, quotes and invoices that share the same phone number, email or exact address (there is no separate customer table). Give a bookingId (best) or phone/email/address/name. Each record says what it matched on.',
    {
      bookingId: id.optional(), phone: z.string().max(30).optional(), email: text().optional(),
      address: text().optional(), name: text().optional().describe('Exact full name — only used when nothing else is given'),
    },
    (args) => data.getCustomerHistory(ctx, args));

  // ── Schedule ─────────────────────────────────────────────────────────────

  tool('list_schedule', 'List jobs & quote visits by date',
    'Jobs and quote visits for a date or date range in Australia/Sydney time (daylight saving handled). kind="scheduled" (default) = calendar slots; "requested_unscheduled" = customer-requested dates not yet scheduled; "recurring_projected" = upcoming visits projected from recurring plans (not yet booked). For one day, set from and to to the same date. Max range 400 days.',
    {
      from: date, to: date,
      kind: z.enum(['scheduled', 'requested_unscheduled', 'recurring_projected']).optional(),
      visitType: z.enum(['all', 'jobs', 'quote_visits']).optional(),
      includeCancelled: z.boolean().optional(),
      assignedGuestId: id.optional(),
      ...page,
    },
    async ({ cursor, pageSize, ...a }) => {
      if (a.to < a.from) return { error: '"to" must be on or after "from".' };
      if (daysBetween(a.from, a.to) > 400) return { error: 'Date range too large (max 400 days). Split it into smaller ranges.' };
      return data.listSchedule(ctx, { kind: 'scheduled', visitType: 'all', ...a }, cursor, pageSize);
    });

  // ── Quotes, invoices, payments, plans ────────────────────────────────────

  tool('list_quotes', 'List quotes',
    'List quote documents (Q-numbers) with full line items, scope/exclusions, assumptions, discounts, totals, validity, status and linked booking. Filter by text, booking, status, quote date or expiry.',
    {
      query: text().optional(), bookingId: id.optional(), status: z.array(z.enum(['draft', 'sent'])).optional(),
      quoteDateFrom: date.optional(), quoteDateTo: date.optional(), expired: z.boolean().optional(), ...page,
    },
    ({ cursor, pageSize, ...f }) => data.listQuotes(ctx, f, cursor, pageSize));

  tool('get_quote', 'Get complete quote',
    'One quote by id (QT-…) or number (e.g. Q1003): every field, computed line items, discount breakdown, total, GST note, payment terms, validity, inferred acceptance, public link, the linked booking and the quote\'s activity history.',
    { idOrNumber: id },
    ({ idOrNumber }) => data.getQuoteFull(ctx, idOrNumber));

  tool('list_invoices', 'List invoices',
    'List invoices with line items, totals, due dates, payment status/method, amount paid and outstanding balance. paymentState: paid | unpaid (sent or draft) | overdue | draft | cancelled.',
    {
      query: text().optional(), bookingId: id.optional(),
      status: z.array(z.enum(['draft', 'sent', 'paid', 'cancelled'])).optional(),
      paymentState: z.enum(['paid', 'unpaid', 'overdue', 'draft', 'cancelled']).optional(),
      invoiceDateFrom: date.optional(), invoiceDateTo: date.optional(), dueDateFrom: date.optional(), dueDateTo: date.optional(),
      paidFrom: date.optional(), paidTo: date.optional(), ownerGuestId: id.optional(), ...page,
    },
    ({ cursor, pageSize, ...f }) => data.listInvoices(ctx, f, cursor, pageSize));

  tool('get_invoice', 'Get complete invoice',
    'One invoice by id (INV-…) or number (e.g. GB1050): every field incl. line items, bill-to, client/DVA block, bank details, Square card-payment fields, plus derived payment history, customer view log (when/where it was opened), activity history and linked bookings.',
    { idOrNumber: id },
    ({ idOrNumber }) => data.getInvoiceFull(ctx, idOrNumber));

  tool('list_payments', 'List payment events',
    'Payment history across the business, newest first: invoices marked paid, bookings marked paid, Square card-payment reports and customer "I\'ve paid" taps (the last two are claims until the owner confirms). Filter by Sydney date range and kind.',
    {
      from: date.optional(), to: date.optional(),
      kinds: z.array(z.enum(['invoice_paid', 'booking_marked_paid', 'square_card_payment_reported', 'customer_tapped_ive_paid'])).optional(),
      ...page,
    },
    ({ cursor, pageSize, ...f }) => data.listPayments(ctx, f, cursor, pageSize));

  tool('list_recurring_plans', 'List recurring plans',
    'Recurring maintenance plans (weekly…biannual/custom) with customer details, service, price per visit, billing cycle, next visit date, notes and the next 6 projected visit dates.',
    {
      active: z.boolean().optional(), query: text().optional(),
      frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'biannual', 'custom']).optional(),
      nextDateFrom: date.optional(), nextDateTo: date.optional(), ...page,
    },
    ({ cursor, pageSize, ...f }) => data.listRecurringPlans(ctx, f, cursor, pageSize));

  tool('get_recurring_plan', 'Get recurring plan',
    'One recurring plan by id (RJ-…) with every field, projected visits and every booking it has generated.',
    { id },
    ({ id }) => data.getRecurringPlanFull(ctx, id));

  // ── Notes, history, photos ───────────────────────────────────────────────

  tool('list_activity', 'List activity history',
    'The admin activity log (bookings created/status changes/deleted, invoices, quotes, payments, settings changes, guests…), newest first. Filter by type (exact, or a prefix ending in "." like "booking."), bookingId, invoiceId, quoteId, actor (admin | customer | system | guest:<id>) and Sydney date range.',
    {
      type: z.string().max(60).regex(/^[a-z_.]+$/).optional(), bookingId: id.optional(), invoiceId: id.optional(), quoteId: id.optional(),
      actor: z.string().max(80).optional(), from: date.optional(), to: date.optional(), ...page,
    },
    ({ cursor, pageSize, ...f }) => data.listActivity(ctx, f, cursor, pageSize));

  tool('get_photo_links', 'Get job photos',
    'Before/after/progress photos for a booking, as secure links that expire after 15 minutes.',
    { bookingId: id },
    ({ bookingId }) => data.getPhotoLinks(ctx, bookingId));

  // ── Reports, settings, integrations ──────────────────────────────────────

  tool('get_report', 'Get business report',
    'Business summaries: overview (dashboard totals, status counts, revenue, owed, upcoming), business (conversion, average quote, sources, suburbs, services, feedback, debtor days, overdue), revenue_by_month, pipeline (stages, auto-moved, flagged), quoted_not_booked (customers quoted but not booked — paginated), owed (completed-unpaid jobs + unpaid invoices — paginated), site_traffic (page views, referrers, scroll, time on page, booking-form funnel).',
    {
      report: z.enum(['overview', 'business', 'revenue_by_month', 'pipeline', 'quoted_not_booked', 'owed', 'site_traffic']),
      months: z.number().int().min(1).max(60).optional().describe('overview / revenue_by_month: how many months back (default 12)'),
      days: z.number().int().min(1).max(365).optional().describe('site_traffic: how many days back (default 30)'),
      ...page,
    },
    ({ report, months, days, cursor, pageSize }) => data.report(ctx, report, { months, days }, cursor, pageSize));

  tool('get_business_settings', 'Get business settings',
    'Admin settings and business configuration: app settings (notifications, Square, reviews, scheduling, public site, LARP toggles), business "from" profiles, payment (bank) profiles, subcontractor guest logins (no passwords) with job counts, and booking groups.',
    {},
    () => data.getBusinessSettings(ctx));

  tool('get_facebook_lead_sync_status', 'Facebook lead sync status',
    'Status of the Facebook/Instagram Lead Ads → Google Sheet → bookings import: configuration, imported lead counts by status, most recent imports, dismissed leads. checkSheet=true also reads the Google Sheet live (read-only) and lists any rows not yet imported.',
    { checkSheet: z.boolean().optional() },
    async ({ checkSheet }) => {
      const status = await data.getFacebookLeadStatus(ctx);
      return checkSheet ? { ...status, liveSheetCheck: await data.checkLeadSheet(ctx) } : status;
    });

  tool('describe_data_coverage', 'What data is available',
    'Lists every admin section and database table and which tool exposes it, what is deliberately excluded (and why), known gaps in what the admin records, and data conventions (ids, null vs empty, time zones, pagination).',
    {},
    async () => ({ conventions: DATA_CONVENTIONS, tables: TABLE_COVERAGE, excludedTables: EXCLUDED_TABLES, adminSections: ADMIN_SECTIONS, knownGaps: KNOWN_GAPS }));

  return server;
}
