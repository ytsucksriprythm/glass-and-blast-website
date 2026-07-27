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
// Transport: Streamable HTTP, bound to 127.0.0.1 only (this build of Claude
// Desktop's "Add custom connector" dialog only accepts a URL, not a spawned
// local command — see mcp-server/README.md). Stateless: each request gets
// its own McpServer + transport pair, so there's no session state to manage
// for what's a purely read-only, single-user local tool.

import dotenv from 'dotenv';
import path from 'path';

// Load the same .env.local the Next.js app uses (gitignored, contains the
// production DATABASE_URL). Must happen before importing db.ts, since db.ts
// reads process.env at module load time.
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  getBookings, getBookingById, getInvoices, getInvoiceById, getRecurringJobs,
  getGuests, getPageViews, getSettings,
  type Booking, type BookingStatus, type PageView,
} from '../src/lib/db';
import { type Invoice, type InvoiceStatus, isInvoiceOverdue, debtorDays } from '../src/lib/invoice';

const LARP_ID_PREFIX = 'LARP-';
const LARP_VISITOR_PREFIX = 'larp_';

const isRealId = (id: string) => !id.startsWith(LARP_ID_PREFIX);
const isRealView = (v: PageView) => !v.visitor.startsWith(LARP_VISITOR_PREFIX);

function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ─── Real (non-LARP) data loader ────────────────────────────────────────────
// Every tool goes through this so "real" always means the same thing.
async function loadRealData() {
  const [allBookings, allInvoices, allRecurring, pv, settings] = await Promise.all([
    getBookings(), getInvoices(), getRecurringJobs(), getPageViews(30), getSettings(),
  ]);
  const bookings = allBookings.filter(b => isRealId(b.id));
  const invoices = allInvoices.filter(i => isRealId(i.id));
  const recurring = allRecurring.filter(r => isRealId(r.id));
  const views = pv.views.filter(isRealView);

  const fakeCounts = {
    bookings: allBookings.length - bookings.length,
    invoices: allInvoices.length - invoices.length,
    recurringPlans: allRecurring.length - recurring.length,
    pageViews30d: pv.views.length - views.length,
  };
  const larpActive = Object.values(fakeCounts).some(n => n > 0);

  return {
    bookings, invoices, recurring, views, allTimeViewsRaw: pv.allTime,
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
  };
}

function buildSiteStats(views: PageView[]) {
  const now = new Date();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const todayKey = dayKey(now);
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const pageCounts: Record<string, number> = {};
  views.forEach(v => { pageCounts[v.path] = (pageCounts[v.path] ?? 0) + 1; });
  const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([path, views]) => ({ path, views }));

  return {
    views30d: views.length,
    today: views.filter(v => dayKey(new Date(v.createdAt)) === todayKey).length,
    last7: views.filter(v => new Date(v.createdAt) >= sevenAgo).length,
    uniqueVisitors30d: new Set(views.map(v => v.visitor).filter(Boolean)).size,
    topPages,
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

// ─── Server factory ──────────────────────────────────────────────────────
// Stateless HTTP mode needs a fresh McpServer + transport pair per request,
// so tool registration lives in a function rather than at module scope.

function createServer(): McpServer {
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
      const booking = await getBookingById(id);
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
      description: 'Business performance stats matching the admin Business Stats tab (conversion rate, avg quote, top suburbs, debtor days, overdue invoices) computed from real data only.',
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
      description: 'Public-site traffic stats (last 30 days) matching the admin Site Stats tab, computed with LARP-mode fake page views excluded.',
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      const { views, demoData } = await loadRealData();
      return jsonResult({ ...buildSiteStats(views), _demoData: demoData });
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
      const invoice = await getInvoiceById(id);
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
      const guests = await getGuests();
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

  return server;
}

// ─── HTTP server (Streamable HTTP, stateless, localhost-only) ────────────

const PORT = Number(process.env.MCP_PORT ?? 8420);

async function main() {
  // createMcpExpressApp() already wires up express.json() and (for a
  // localhost host) DNS-rebinding protection — nothing else needed here.
  const app = createMcpExpressApp({ host: '127.0.0.1' });

  app.post('/mcp', async (req, res) => {
    // Stateless mode: a fresh server + transport per request avoids request-id
    // collisions across concurrent calls. Cheap — tool handlers do the real work.
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('MCP request failed:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Stateless mode has no server-initiated notifications, so GET/DELETE aren't supported.
  app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Method not allowed (stateless server)' }));
  app.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Method not allowed (stateless server)' }));

  app.listen(PORT, '127.0.0.1', () => {
    console.error(`Glass & Blast MCP server running (read-only, live production data).`);
    console.error(`Connector URL for Claude Desktop: http://127.0.0.1:${PORT}/mcp`);
  });
}

main().catch(err => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
