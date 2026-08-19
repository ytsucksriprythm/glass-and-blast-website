#!/usr/bin/env node
// Read-only MCP connector for Claude Desktop — exposes Glass & Blast's live
// production data (Neon) as MCP tools so Claude can answer questions about
// bookings, invoices, and business performance directly from a chat.
//
// Read-only by design: every tool here only ever calls the `get*` /
// `list*`-style functions in src/lib/db.ts. Nothing in this file can create,
// update, or delete a record. See mcp-server/README.md for setup.
//
// LARP mode ("make us look busy" demo data, see src/lib/larp.ts) injects fake
// rows tagged with an id prefix — 'LARP-' for bookings/invoices/recurring
// plans, 'larp_' for page-view visitor ids. Every tool below filters those
// out before computing anything, and every response carries a `_demoData`
// block reporting whether LARP mode currently has fake rows live and how
// many were excluded — so Claude never mistakes inflated demo numbers for
// real ones, even though nothing about the admin UI itself changes.
//
// Transport: stdio, spawned directly by Claude Desktop's "Developer → Local
// MCP servers" config (NOT the account-level "Connectors" UI — that one
// validates/calls URLs from Anthropic's own servers, which can never reach
// 127.0.0.1 on this machine; see mcp-server/README.md for how these two
// differ and why this had to be stdio, not Streamable HTTP).

import dotenv from 'dotenv';
import path from 'path';

// Load mcp-server/.env — NOT the repo root's .env.local. That file's
// DATABASE_URL is deliberately left blank (see its own comment) so a plain
// `npm run dev` never touches production; this connector needs the opposite
// (always production, read-only), so it gets its own gitignored env file
// with just DATABASE_URL_UNPOOLED, isolated from that safety guard. Pulled
// from Neon's own console — Vercel's copy of this value is marked
// "Sensitive" and is unretrievable via `vercel env pull` once set that way.
//
// Loading must happen before db.ts's top-level code reads process.env — but
// a plain `dotenv.config()` call here is NOT reliably "before" that: this
// file's own `import ... from '../src/lib/db'` below can execute before
// this statement regardless of source order, depending on how the runtime
// resolves the module graph. That's exactly what happened once already
// (db.ts silently fell back to the local JSON store — with `process.cwd()`
// defaulting to `C:\WINDOWS\System32` since Claude Desktop spawns this with
// no explicit cwd — and crashed on `mkdir` there). The *real* fix is the
// `-r dotenv/config` preload + explicit `cwd` in mcp-server/README.md's
// Claude Desktop config, which runs before this module (or its imports) is
// even loaded. This call stays only as the primary loader for direct
// invocations like `npm run mcp` that don't use the preload flag, and the
// check right after is a fail-loud backstop if neither path set
// DATABASE_URL_UNPOOLED — better a clear startup error than a confusing
// EPERM from the JSON-store fallback.
//
// `quiet: true` is not optional here, unlike a normal script: on stdio
// transport, stdout is the JSON-RPC wire — dotenv's own "injected env from
// .env" tip line (printed to stdout by default) corrupts every message
// after it, which is exactly what caused Claude Desktop's "not valid JSON"
// error the first time this ran without it.
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const HAS_DB_CONN = Boolean(
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL || process.env.POSTGRES_URL,
);
if (!HAS_DB_CONN) {
  console.error(
    'FATAL: no DATABASE_URL_UNPOOLED (or POSTGRES_URL_NON_POOLING/DATABASE_URL/POSTGRES_URL) found ' +
    'in the environment. This server only ever talks to the production Neon database — it will not ' +
    'silently fall back to the local JSON store. Check that mcp-server/.env exists (see ' +
    'mcp-server/README.md) and the Claude Desktop config\'s `cwd` / `-r dotenv/config` preload are ' +
    'set correctly.',
  );
  process.exit(1);
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  getBookings, getBookingById, getInvoices, getInvoiceById, getRecurringJobs,
  getGuests, getPageViews, getFunnelEvents, getSettings, ensureSchema,
  type Booking, type BookingStatus, type PageView, type FunnelEvent,
} from '../src/lib/db';
import { type Invoice, type InvoiceStatus, isInvoiceOverdue, debtorDays } from '../src/lib/invoice';
import {
  computePageEngagement, computeScrollBuckets, computeSiteWideTimeStats, computeBookingFunnel,
} from '../src/lib/analytics';

const LARP_ID_PREFIX = 'LARP-';
const LARP_VISITOR_PREFIX = 'larp_';

const isRealId = (id: string) => !id.startsWith(LARP_ID_PREFIX);
const isRealView = (v: PageView) => !v.visitor.startsWith(LARP_VISITOR_PREFIX);

// Belt-and-suspenders alongside the ensureSchema() warm-up in main(): if a
// tool call still lands before that warm-up finishes (e.g. right at
// startup), db.ts's internal 8s withTimeout() will reject it — retry once
// after a short pause rather than surfacing a raw timeout to Claude. The
// underlying schema-check promise keeps running server-side even after a
// timeout rejects the caller, so by the retry it's almost always resolved.
async function withDbRetry<T>(fn: () => Promise<T>, attemptsLeft = 2): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attemptsLeft <= 0) throw err;
    await new Promise(resolve => setTimeout(resolve, 1500));
    return withDbRetry(fn, attemptsLeft - 1);
  }
}

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Real (non-LARP) data loader ────────────────────────────────────────────
// Every tool goes through this so "real" always means the same thing.
async function loadRealData() {
  const [allBookings, allInvoices, allRecurring, pv, settings, funnelEvents] = await withDbRetry(() => Promise.all([
    getBookings(), getInvoices(), getRecurringJobs(), getPageViews(30), getSettings(), getFunnelEvents(30),
  ]));
  const bookings = allBookings.filter(b => isRealId(b.id));
  const invoices = allInvoices.filter(i => isRealId(i.id));
  const recurring = allRecurring.filter(r => isRealId(r.id));
  const views = pv.views.filter(isRealView);
  // LARP mode never fakes booking-form funnel interactions (only page
  // views/bookings/invoices/recurring plans), so every row here is real.

  const fakeCounts = {
    bookings: allBookings.length - bookings.length,
    invoices: allInvoices.length - invoices.length,
    recurringPlans: allRecurring.length - recurring.length,
    pageViews30d: pv.views.length - views.length,
  };
  const larpActive = Object.values(fakeCounts).some(n => n > 0);

  return {
    bookings, invoices, recurring, views, funnelEvents, allTimeViewsRaw: pv.allTime,
    demoData: {
      larpModeCurrentlyActive: larpActive,
      note: larpActive
        ? 'LARP/demo mode currently has fake rows in the database. Every figure in this response has already had them excluded — treat these as the real business numbers, not what the on-screen admin dashboard may currently show.'
        : 'No LARP/demo fake data is currently present. These figures are the real business numbers.',
      excludedFakeRowCounts: fakeCounts,
      allTimePageViewsIncludesDemoTraffic: larpActive,
      larpToggleConfig: {
        larpFakeNumbers: settings.larpFakeNumbers,
        larpFakeBookings: settings.larpFakeBookings,
        larpFakeColdLeads: settings.larpFakeColdLeads,
        larpFakeInvoices: settings.larpFakeInvoices,
        larpFakeCalendar: settings.larpFakeCalendar,
        larpRevenueTarget: settings.larpRevenueTarget,
      },
    },
  };
}

// ─── Aggregation (mirrors src/lib/db.ts getStats/getBusinessStats/getSiteStats,
// but operating on the caller-supplied, already-filtered arrays above) ──────

function buildDashboardStats(bookings: Booking[]) {
  const now = new Date();
  const statusBreakdown: Record<BookingStatus, number> = {
    pending: 0, quoted: 0, confirmed: 0, completed: 0, cancelled: 0, cold: 0,
  };
  bookings.forEach(b => { statusBreakdown[b.status] = (statusBreakdown[b.status] ?? 0) + 1; });

  const thisMonth = bookings.filter(b => {
    const d = new Date(b.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const quotedBookings = bookings.filter(b => typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0);
  const quotedValue = quotedBookings.reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);
  const paidValue = bookings.filter(b => b.paid && typeof b.quoteAmount === 'number').reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);
  const owed = bookings.filter(b => !b.paid && b.status === 'completed' && typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0);
  const owedValue = owed.reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);

  return {
    total: bookings.length,
    thisMonth,
    statusBreakdown,
    quotedCount: quotedBookings.length,
    quotedValue,
    paidRevenue: paidValue,
    owedCount: owed.length,
    owedValue,
  };
}

function buildBusinessStats(bookings: Booking[], invoices: Invoice[]) {
  const total = bookings.length;
  const completed = bookings.filter(b => b.status === 'completed').length;
  const withQuote = bookings.filter(b => typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0);
  const avgQuote = withQuote.length
    ? Math.round(withQuote.reduce((s, b) => s + (b.quoteAmount ?? 0), 0) / withQuote.length)
    : 0;

  const subCounts: Record<string, number> = {};
  bookings.forEach(b => {
    const s = (b.suburb || '').trim();
    if (s) subCounts[s] = (subCounts[s] ?? 0) + 1;
  });
  const topSuburbs = Object.entries(subCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([suburb, count]) => ({ suburb, count }));

  const debtorSamples = invoices.map(debtorDays).filter((d): d is number => d != null);
  const avgDebtorDays = debtorSamples.length
    ? Math.round(debtorSamples.reduce((a, b) => a + b, 0) / debtorSamples.length)
    : null;
  const overdueInvoices = invoices.filter(isInvoiceOverdue);

  // Auto-captured for website bookings only (manual adds use leadSource
  // instead — see src/lib/attribution.ts).
  const attributionCounts: Record<string, number> = {};
  bookings.forEach(b => { if (b.source === 'website' && b.attributionSource) attributionCounts[b.attributionSource] = (attributionCounts[b.attributionSource] ?? 0) + 1; });
  const websiteBookingSources = Object.entries(attributionCounts).sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }));

  return {
    total,
    completed,
    conversionRate: total ? Math.round((completed / total) * 100) : 0,
    avgQuote,
    paidValue: bookings.filter(b => b.paid).reduce((s, b) => s + (b.quoteAmount ?? 0), 0),
    owedValue: bookings.filter(b => !b.paid && b.status === 'completed').reduce((s, b) => s + (b.quoteAmount ?? 0), 0),
    topSuburbs,
    avgDebtorDays,
    overdueInvoiceCount: overdueInvoices.length,
    overdueInvoiceValue: overdueInvoices.reduce((s, i) => s + i.total, 0),
    leadsBySource: {
      website: bookings.filter(b => (b.source ?? 'website') === 'website').length,
      manual: bookings.filter(b => b.source === 'manual').length,
    },
    websiteBookingSources,
  };
}

// views/funnelEvents already have LARP-mode rows filtered out by loadRealData().
function buildSiteStats(views: PageView[], funnelEvents: FunnelEvent[]) {
  const now = new Date();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const todayKey = dayKey(now);
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const pageCounts: Record<string, number> = {};
  views.forEach(v => { pageCounts[v.path] = (pageCounts[v.path] ?? 0) + 1; });
  const rankedPaths = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([path, n]) => ({ path, views: n }));
  // Scroll depth, time-on-page, and the booking-form funnel all use the same
  // aggregation as the admin Site Stats tab (src/lib/analytics.ts) so this
  // connector never reports different numbers than the dashboard does.
  const topPages = computePageEngagement(views, rankedPaths);
  const { buckets: scrollBuckets, sampleCount: scrollSampleCount } = computeScrollBuckets(views);
  const { avgTimeOnPageSeconds, timeSamples, avgSessionDurationSeconds, sessionSamples } = computeSiteWideTimeStats(views);
  const { steps: bookingFunnel, started: bookingFunnelStarted } = computeBookingFunnel(funnelEvents);

  return {
    views30d: views.length,
    today: views.filter(v => dayKey(new Date(v.createdAt)) === todayKey).length,
    last7: views.filter(v => new Date(v.createdAt) >= sevenAgo).length,
    uniqueVisitors30d: new Set(views.map(v => v.visitor).filter(Boolean)).size,
    topPages,
    scrollBuckets,
    scrollSampleCount,
    avgTimeOnPageSeconds,
    timeSamples,
    avgSessionDurationSeconds,
    sessionSamples,
    bookingFunnel,
    bookingFunnelStarted,
  };
}

const BOOKING_STATUS_VALUES = ['pending', 'quoted', 'confirmed', 'completed', 'cancelled', 'cold'] as const;
const INVOICE_STATUS_VALUES = ['draft', 'sent', 'paid', 'cancelled'] as const;

function bookingSummary(b: Booking) {
  return {
    id: b.id, name: b.name, phone: b.phone, email: b.email,
    suburb: b.suburb, address: b.address,
    service: b.service, propertyType: b.propertyType,
    status: b.status, quoteAmount: b.quoteAmount ?? null, paid: b.paid,
    preferredDate: b.preferredDate, preferredTime: b.preferredTime,
    leadSource: b.leadSource ?? null, // manual-add attribution, e.g. "Real estate agent"
    attributionSource: b.attributionSource ?? null, // auto-captured for website bookings, e.g. "Facebook (bio link)"
    scheduledAt: b.scheduledAt ?? null,
    contactedAt: b.contactedAt ?? null,
    assignedGuestId: b.assignedGuestId ?? null,
    createdAt: b.createdAt, updatedAt: b.updatedAt,
  };
}

function invoiceSummary(i: Invoice) {
  return {
    id: i.id, number: i.number, status: i.status, isTaxInvoice: i.isTaxInvoice,
    total: i.total, paymentMethod: i.paymentMethod,
    invoiceDate: i.invoiceDate, dueDate: i.dueDate,
    sentAt: i.sentAt, paidAt: i.paidAt,
    overdue: isInvoiceOverdue(i),
    bookingIds: i.bookingIds, ownerGuestId: i.ownerGuestId,
    billToName: i.billToName,
  };
}

// ─── Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'glass-and-blast',
  version: '1.0.0',
}, {
  instructions:
    'Read-only access to Glass & Blast Window Cleaning\'s live business data ' +
    '(bookings, invoices, recurring plans, guests, site traffic). No tool here ' +
    'can modify data. Every response includes a `_demoData` block describing ' +
    'LARP/demo mode: figures are always computed with LARP-mode fake rows ' +
    'already excluded, so treat them as the real numbers even if the admin ' +
    'dashboard is currently showing inflated demo figures.',
});

server.registerTool(
  'list_bookings',
  {
    title: 'List bookings',
    description: 'List real (non-demo) bookings, optionally filtered by status or a name/suburb/address search term. Excludes LARP-mode demo data.',
    inputSchema: {
      status: z.enum(BOOKING_STATUS_VALUES).optional().describe('Filter to a single booking status'),
      search: z.string().optional().describe('Case-insensitive match against name, suburb, address, or phone'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows to return (default 50)'),
    },
  },
  async ({ status, search, limit }): Promise<CallToolResult> => {
    const { bookings, demoData } = await loadRealData();
    let rows = bookings;
    if (status) rows = rows.filter(b => b.status === status);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(b =>
        b.name.toLowerCase().includes(q) || b.suburb.toLowerCase().includes(q) ||
        b.address.toLowerCase().includes(q) || b.phone.toLowerCase().includes(q));
    }
    rows = rows.slice(0, limit ?? 50);
    return jsonResult({ count: rows.length, bookings: rows.map(bookingSummary), _demoData: demoData });
  },
);

server.registerTool(
  'get_booking',
  {
    title: 'Get booking detail',
    description: 'Get full detail for one real booking by id. Refuses LARP-mode demo booking ids.',
    inputSchema: { id: z.string().describe('Booking id, e.g. BK-1730000000000') },
  },
  async ({ id }): Promise<CallToolResult> => {
    if (!isRealId(id)) return errorResult('That id belongs to LARP/demo mode fake data, not a real booking.');
    const booking = await withDbRetry(() => getBookingById(id));
    if (!booking) return errorResult(`No booking found with id ${id}`);
    return jsonResult(booking);
  },
);

server.registerTool(
  'get_dashboard_stats',
  {
    title: 'Get dashboard stats',
    description: 'Overview stats matching the admin Dashboard tab (booking counts, status breakdown, quoted/paid/owed revenue) computed from real bookings only.',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const { bookings, demoData } = await loadRealData();
    return jsonResult({ ...buildDashboardStats(bookings), _demoData: demoData });
  },
);

server.registerTool(
  'get_business_stats',
  {
    title: 'Get business stats',
    description:
      'Business performance stats matching the admin Business Stats tab (conversion rate, avg quote, top suburbs, debtor days, ' +
      'overdue invoices) computed from real data only. websiteBookingSources breaks down website bookings by how the visitor ' +
      'found the site (Facebook bio link, Google Maps, Google search, Direct, etc. — see attributionSource on individual bookings ' +
      'too); leadsBySource is the coarser website-vs-manual split.',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const { bookings, invoices, demoData } = await loadRealData();
    return jsonResult({ ...buildBusinessStats(bookings, invoices), _demoData: demoData });
  },
);

server.registerTool(
  'get_site_stats',
  {
    title: 'Get site traffic stats',
    description:
      'Public-site traffic stats (last 30 days) matching the admin Site Stats tab, computed with LARP-mode fake page views excluded. ' +
      'Includes: page views by day/page/referrer; scroll depth (how far down each page visitors got before leaving, plus a ' +
      '0-25/26-50/51-75/76-100% distribution); time on page and average session duration (avgTimeOnPageSeconds per page, ' +
      'avgSessionDurationSeconds site-wide — a "session" is one visitor\'s daily hash, see PageView.visitor); and the booking-form ' +
      'funnel (bookingFunnel — cumulative counts of how many visitors reached each field of the booking form on the homepage before ' +
      'leaving or submitting: name -> phone -> service -> address -> extras -> submitted). Scroll/time/funnel fields can be null or ' +
      'zero-sample if tracking is new or a visitor bounced before the JS listener could report anything — that is genuinely "no data", not "0%"/"0s".',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const { views, funnelEvents, demoData } = await loadRealData();
    return jsonResult({ ...buildSiteStats(views, funnelEvents), _demoData: demoData });
  },
);

server.registerTool(
  'list_invoices',
  {
    title: 'List invoices',
    description: 'List real (non-demo) invoices, optionally filtered by status. Excludes LARP-mode demo invoices (GB9000+ fake numbering).',
    inputSchema: {
      status: z.enum(INVOICE_STATUS_VALUES).optional().describe('Filter to a single invoice status'),
      limit: z.number().int().min(1).max(200).optional().describe('Max rows to return (default 50)'),
    },
  },
  async ({ status, limit }): Promise<CallToolResult> => {
    const { invoices, demoData } = await loadRealData();
    let rows = invoices;
    if (status) rows = rows.filter(i => i.status === status);
    rows = rows.slice(0, limit ?? 50);
    return jsonResult({ count: rows.length, invoices: rows.map(invoiceSummary), _demoData: demoData });
  },
);

server.registerTool(
  'get_invoice',
  {
    title: 'Get invoice detail',
    description: 'Get full detail for one real invoice by id. Refuses LARP-mode demo invoice ids.',
    inputSchema: { id: z.string().describe('Invoice id, e.g. INV-1730000000000') },
  },
  async ({ id }): Promise<CallToolResult> => {
    if (!isRealId(id)) return errorResult('That id belongs to LARP/demo mode fake data, not a real invoice.');
    const invoice = await withDbRetry(() => getInvoiceById(id));
    if (!invoice) return errorResult(`No invoice found with id ${id}`);
    return jsonResult(invoice);
  },
);

server.registerTool(
  'list_recurring_plans',
  {
    title: 'List recurring plans',
    description: 'List real (non-demo) recurring job plans.',
    inputSchema: {
      activeOnly: z.boolean().optional().describe('Only include active plans (default true)'),
    },
  },
  async ({ activeOnly }): Promise<CallToolResult> => {
    const { recurring, demoData } = await loadRealData();
    const rows = (activeOnly ?? true) ? recurring.filter(r => r.active) : recurring;
    return jsonResult({
      count: rows.length,
      plans: rows.map(r => ({
        id: r.id, name: r.name, suburb: r.suburb, address: r.address,
        frequency: r.frequency, nextDate: r.nextDate, active: r.active,
        discount: r.discount, service: r.service,
      })),
      _demoData: demoData,
    });
  },
);

server.registerTool(
  'list_guests',
  {
    title: 'List guest (subcontractor) logins',
    description: 'List guest/subcontractor accounts. Password hashes are never returned. Not affected by LARP mode.',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const guests = await withDbRetry(() => getGuests());
    return jsonResult(guests.map(g => ({ id: g.id, name: g.name, active: g.active, createdAt: g.createdAt })));
  },
);

server.registerTool(
  'get_larp_mode_status',
  {
    title: 'Get LARP/demo mode status',
    description: 'Reports whether LARP ("make us look busy") demo mode currently has fake data live in the database, how many fake rows of each kind, and the configured toggles. Use this to sanity-check any discrepancy between what you see on screen and the numbers from the other tools here (which always exclude demo data).',
    inputSchema: {},
  },
  async (): Promise<CallToolResult> => {
    const { demoData } = await loadRealData();
    return jsonResult(demoData);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Glass & Blast MCP server running (stdio, read-only, live production data).');

  // Warm the schema-check cache in the background (unbounded — no
  // withTimeout() ceiling here, unlike every getter's normal query path) so
  // the first *real* tool call doesn't pay this cost on top of its own 8s
  // budget. Doesn't block the connect() above: Desktop gets a responsive
  // stdio connection immediately, and this just gives the DB a head start
  // during the natural gap before anyone actually invokes a tool.
  ensureSchema()
    .then(() => console.error('Schema warm-up complete.'))
    .catch(err => console.error('Schema warm-up failed (will retry on first real query):', err instanceof Error ? err.message : err));
}

main().catch(err => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
