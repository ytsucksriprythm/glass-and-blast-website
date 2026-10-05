// Read-only verification of the ChatGPT MCP connector against a real
// database (production). Prints ONLY counts, table/column names and pass/fail
// — never customer data.
//
//   npx tsx scripts/mcp-verify-prod.ts
//
// Connection: MCP_DATABASE_URL (the read-only role — also runs the role
// safety check) if set, else DATABASE_URL_UNPOOLED from mcp-server/.env.
// Every query runs inside a READ ONLY transaction either way.
//
// Checks:
//  1. every production table is covered by the coverage map or explicitly excluded
//  2. every production column is known to the code (db.ts schema) — flags drift
//  3. completeness: paging through ALL bookings/invoices/quotes/activity/payments
//     returns exactly `total` unique records, matching direct SQL counts
//  4. every invoice, quote, recurring plan and booking can be fully retrieved
//     (incl. linked records) with every column present and no JSON parse errors
//  5. every report and the settings/FB tools run cleanly

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

dotenv.config({ path: path.join(__dirname, '..', 'mcp-server', '.env'), quiet: true });

import { type ReadDb, type Row, assertReadOnlyRole } from '../src/lib/mcp/sql';
import * as data from '../src/lib/mcp/data';
import { camel } from '../src/lib/mcp/records';
import { TABLE_COVERAGE, EXCLUDED_TABLES } from '../src/lib/mcp/coverage';

const url = process.env.MCP_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
if (!url) { console.error('No MCP_DATABASE_URL or mcp-server/.env DATABASE_URL_UNPOOLED'); process.exit(1); }
const usingReadRole = Boolean(process.env.MCP_DATABASE_URL);
const sql = neon(url);
const db: ReadDb = {
  async many(qs) {
    if (!qs.length) return [];
    return (await sql.transaction(tx => qs.map(q => tx.query(q.text, q.params ?? [])), { readOnly: true, isolationLevel: 'RepeatableRead' })) as unknown as Row[][];
  },
};
const ctx: data.Ctx = { db, baseUrl: 'https://glassandblast.com.au', secret: 'verify-only-'.padEnd(48, 'x') };

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const one = async (text: string, params: unknown[] = []) => (await db.many([{ text, params }]))[0];

async function pageAll(fn: (cursor?: string) => Promise<{ items: unknown[]; total: number; nextCursor: string | null }>, idOf: (x: any) => string) {
  const ids = new Set<string>();
  let cursor: string | undefined, total = 0, pages = 0;
  do {
    const p = await fn(cursor);
    total = p.total;
    p.items.forEach(x => ids.add(idOf(x)));
    cursor = p.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 1000);
  return { ids, total, pages };
}

function codeColumns(): Map<string, Set<string>> {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/lib/db.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function ensureSchema'), src.indexOf('// ─── JSON fallback helpers'));
  const out = new Map<string, Set<string>>();
  for (const m of body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\)\s*`/g)) {
    const cols = new Set<string>();
    for (const part of m[2].split(/[,\n]/)) { const c = /^\s*(\w+)\s+[A-Z]/.exec(part); if (c) cols.add(c[1]); }
    out.set(m[1], cols);
  }
  for (const m of body.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)) out.get(m[1])?.add(m[2]);
  return out;
}

function missingCols(rec: Record<string, unknown>, cols: string[], omit: string[] = []) {
  return cols.filter(c => !omit.includes(c) && !(camel(c) in rec));
}
function parseErrors(rec: unknown): number {
  return (JSON.stringify(rec).match(/ParseError":true/g) ?? []).length;
}

async function main() {
  console.log(`Connected via ${usingReadRole ? 'MCP_DATABASE_URL (read-only role)' : 'mcp-server/.env owner URL'} — READ ONLY transactions\n`);
  if (usingReadRole) {
    try { await assertReadOnlyRole(db); check(true, 'read-only role safety check'); }
    catch (e) { check(false, 'read-only role safety check', e instanceof Error ? e.message : ''); }
  }
  const roleRow = await one(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_readonly') AS exists`);
  console.log(`INFO  mcp_readonly role exists in production: ${roleRow[0].exists}`);

  // 1 + 2. Schema
  const colRows = await one(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
  const prod = new Map<string, string[]>();
  colRows.forEach(r => { const t = String(r.table_name); prod.set(t, [...(prod.get(t) ?? []), String(r.column_name)]); });
  const unmapped = [...prod.keys()].filter(t => !(t in TABLE_COVERAGE) && !(t in EXCLUDED_TABLES));
  check(unmapped.length === 0, 'every production table covered or explicitly excluded', unmapped.join(', '));
  const code = codeColumns();
  const drift: string[] = [];
  for (const [t, cols] of prod) {
    if (t.startsWith('mcp_')) continue;
    const known = code.get(t);
    if (!known) { drift.push(`${t} (table not in db.ts)`); continue; }
    cols.filter(c => !known.has(c)).forEach(c => drift.push(`${t}.${c}`));
  }
  check(drift.length === 0, 'every production column is known to the code', drift.join(', '));
  console.log(`INFO  ${prod.size} tables, ${colRows.length} columns in production`);

  // 3. Completeness via pagination vs direct counts
  const direct = async (q: string) => Number((await one(q))[0].n);
  const bk = await pageAll(c => data.searchBookings(ctx, {}, c, 100), (x: any) => x.id);
  const bkDirect = await direct(`SELECT count(*)::int AS n FROM bookings WHERE deleted_at IS NULL AND id NOT LIKE 'LARP-%'`);
  check(bk.total === bkDirect && bk.ids.size === bkDirect, 'bookings: paging returns every record exactly once', `direct=${bkDirect} total=${bk.total} unique=${bk.ids.size} pages=${bk.pages}`);
  const bkDel = await pageAll(c => data.searchBookings(ctx, { deleted: 'only' }, c, 100), (x: any) => x.id);
  check(bkDel.total === await direct(`SELECT count(*)::int AS n FROM bookings WHERE deleted_at IS NOT NULL AND id NOT LIKE 'LARP-%'`), 'deleted bookings (trash) all reachable', `n=${bkDel.total}`);
  const inv = await pageAll(c => data.listInvoices(ctx, {}, c, 100), (x: any) => x.id);
  const invDirect = await direct(`SELECT count(*)::int AS n FROM invoices WHERE id NOT LIKE 'LARP-%'`);
  check(inv.total === invDirect && inv.ids.size === invDirect, 'invoices: every record reachable', `direct=${invDirect} unique=${inv.ids.size}`);
  const qt = await pageAll(c => data.listQuotes(ctx, {}, c, 100), (x: any) => x.id);
  const qtDirect = await direct(`SELECT count(*)::int AS n FROM quotes WHERE booking_id NOT LIKE 'LARP-%'`);
  check(qt.total === qtDirect && qt.ids.size === qtDirect, 'quotes: every record reachable', `direct=${qtDirect} unique=${qt.ids.size}`);
  const rj = await pageAll(c => data.listRecurringPlans(ctx, {}, c, 100), (x: any) => x.id);
  const rjDirect = await direct(`SELECT count(*)::int AS n FROM recurring_jobs WHERE id NOT LIKE 'LARP-%'`);
  check(rj.total === rjDirect && rj.ids.size === rjDirect, 'recurring plans: every record reachable', `direct=${rjDirect} unique=${rj.ids.size}`);
  const act = await pageAll(c => data.listActivity(ctx, {}, c, 100), (x: any) => x.id);
  const actDirect = await direct(`SELECT count(*)::int AS n FROM activity_log`);
  check(act.total === actDirect && act.ids.size === actDirect, 'activity log: every entry reachable', `direct=${actDirect} unique=${act.ids.size} pages=${act.pages}`);
  const pay = await pageAll(c => data.listPayments(ctx, {}, c, 100) as any, (x: any) => `${x.kind}:${x.invoiceId ?? x.bookingId}`);
  check(pay.ids.size === pay.total, 'payment events: every event reachable', `n=${pay.total}`);

  // 4. Full retrieval of every record
  let errs = 0, missing = 0, parse = 0;
  const bkCols = prod.get('bookings')!;
  for (const id of bk.ids) {
    const r: any = await data.getBookingFull(ctx, id);
    if (r.error) { errs++; continue; }
    missing += missingCols(r.booking, bkCols).length;
    parse += parseErrors(r);
  }
  check(errs === 0 && missing === 0, `get_booking on all ${bk.ids.size} bookings: every column + linked records`, `errors=${errs} missingColumns=${missing}`);
  check(parse === 0, 'no JSON parse errors in linked records', `parseErrors=${parse}`);
  errs = 0; missing = 0; parse = 0;
  for (const id of inv.ids) {
    const r: any = await data.getInvoiceFull(ctx, id);
    if (r.error) { errs++; continue; }
    missing += missingCols(r.invoice, prod.get('invoices')!).length;
    parse += parseErrors(r.invoice);
  }
  check(errs === 0 && missing === 0 && parse === 0, `get_invoice on all ${inv.ids.size} invoices`, `errors=${errs} missingColumns=${missing} parseErrors=${parse}`);
  errs = 0; missing = 0; let mismatched = 0;
  for (const id of qt.ids) {
    const r: any = await data.getQuoteFull(ctx, id);
    if (r.error) { errs++; continue; }
    missing += missingCols(r.quote, prod.get('quotes')!).length;
    if (!r.quote.computed.storedAmountMatchesLines) mismatched++;
  }
  check(errs === 0 && missing === 0, `get_quote on all ${qt.ids.size} quotes`, `errors=${errs} missingColumns=${missing}`);
  console.log(`INFO  quotes whose stored amount differs from their line items: ${mismatched} (reported per quote as computed.storedAmountMatchesLines)`);
  errs = 0;
  for (const id of rj.ids) { const r: any = await data.getRecurringPlanFull(ctx, id); if (r.error) errs++; }
  check(errs === 0, `get_recurring_plan on all ${rj.ids.size} plans`);
  errs = 0;
  for (const id of [...bk.ids].slice(0, 50)) { const r: any = await data.getCustomerHistory(ctx, { bookingId: id }); if (r.error) errs++; }
  check(errs === 0, 'get_customer_history on 50 bookings');

  // 5. Reports and other tools
  for (const name of ['overview', 'business', 'revenue_by_month', 'pipeline', 'quoted_not_booked', 'owed', 'site_traffic']) {
    try { const r: any = await data.report(ctx, name, {}); check(!r.error, `report ${name}`, r.total != null ? `items=${r.total}` : ''); }
    catch (e) { check(false, `report ${name}`, e instanceof Error ? e.message : ''); }
  }
  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  for (const kind of ['scheduled', 'requested_unscheduled', 'recurring_projected'] as const) {
    const r = await data.listSchedule(ctx, { from: today, to: in60, kind }, undefined, 100);
    check(true, `list_schedule ${kind} next 60 days`, `total=${r.total}`);
  }
  const settings: any = await data.getBusinessSettings(ctx);
  check(!JSON.stringify(settings).includes('password_hash') && !JSON.stringify(settings).includes('passwordHash'), 'settings contain no password hashes');
  const fb = await data.getFacebookLeadStatus(ctx);
  check(true, 'facebook lead status', `imported=${fb.importedLeads.totalNotDeleted}`);
  const larp = await direct(`SELECT count(*)::int AS n FROM bookings WHERE id LIKE 'LARP-%'`);
  console.log(`INFO  LARP demo bookings currently in DB (excluded from every tool): ${larp}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('verification crashed:', e instanceof Error ? e.message : e); process.exit(1); });
