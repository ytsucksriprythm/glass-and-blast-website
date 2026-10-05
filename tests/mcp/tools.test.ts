// Data tests for the ChatGPT MCP connector tools: completeness, pagination,
// Sydney/DST date filters, linked records, read-only enforcement and secret
// exclusion — against real Postgres with the real schema and role.
// Run: npm run test:mcp

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, seed, configureEnv, fullLogin, rpc, callTool, ownerExec, BASE } from './harness';
import { camel } from '../../src/lib/mcp/records';
import { assertReadOnlyRole, getReadDb, setMcpDbsForTesting, readOne } from '../../src/lib/mcp/sql';
import { handlePhoto } from '../../src/lib/mcp/files';
import { signBlob } from '../../src/lib/mcp/crypto';
import { TABLE_COVERAGE, EXCLUDED_TABLES } from '../../src/lib/mcp/coverage';

let token = '';
before(async () => {
  configureEnv();
  await setupDb();
  await seed();
  token = (await fullLogin()).accessToken;
});

const tool = (name: string, args: Record<string, unknown> = {}) => callTool(token, name, args);
const columns = async (table: string) =>
  (await ownerExec(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [table])).map(r => String(r.column_name));

test('only read-only tools are registered, all annotated readOnlyHint', async () => {
  const tools = (await (await rpc(token, 'tools/list')).json()).result.tools as any[];
  assert.ok(tools.length >= 18);
  for (const t of tools) {
    assert.equal(t.annotations?.readOnlyHint, true, t.name);
    assert.equal(t.annotations?.destructiveHint, false, t.name);
    assert.doesNotMatch(t.name, /^(create|update|delete|add|set|append|schedule|reschedule|import|refresh|write|send|mark)/, `${t.name} looks like a write tool`);
  }
});

test('search_bookings pages through every record with totals and cursors — no silent truncation', async () => {
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0, total = -1;
  do {
    const r = await tool('search_bookings', { suburb: 'Bulkville', pageSize: 25, ...(cursor ? { cursor } : {}) });
    assert.equal(r.isError, false, r.text);
    total = r.data.total;
    r.data.items.forEach((b: any) => seen.add(b.id));
    cursor = r.data.nextCursor ?? undefined;
    pages++;
    assert.equal(r.data.hasMore, Boolean(cursor));
  } while (cursor && pages < 10);
  assert.equal(total, 60);
  assert.equal(seen.size, 60);
  assert.equal(pages, 3);
});

test('cursors are tamper-proof and bound to their filters; a row created mid-paging does not shift pages', async () => {
  const first = await tool('search_bookings', { suburb: 'Bulkville', pageSize: 25 });
  const wrongFilters = await tool('search_bookings', { suburb: 'Ainslie', cursor: first.data.nextCursor });
  assert.equal(wrongFilters.isError, true);
  assert.match(wrongFilters.text, /different filters/);
  const tampered = await tool('search_bookings', { suburb: 'Bulkville', cursor: first.data.nextCursor.slice(0, -3) + 'abc' });
  assert.equal(tampered.isError, true);

  await ownerExec(`INSERT INTO bookings (id, name, phone, service, property_type, suburb, created_at) VALUES ('BK-BULK-NEW', 'New Mid Paging', '1', 'other', 'residential', 'Bulkville', now() + interval '1 minute')`);
  try {
    const second = await tool('search_bookings', { suburb: 'Bulkville', pageSize: 25, cursor: first.data.nextCursor });
    assert.equal(second.data.total, 60, 'snapshot total unchanged');
    assert.ok(!second.data.items.some((b: any) => b.id === 'BK-BULK-NEW'));
  } finally {
    await ownerExec(`DELETE FROM bookings WHERE id = 'BK-BULK-NEW'`);
  }
});

test('search by name, phone (any format), email, address, suburb, source, status and date', async () => {
  const ids = async (args: Record<string, unknown>) => (await tool('search_bookings', args)).data.items.map((b: any) => b.id).sort();
  assert.deepEqual(await ids({ phone: '0412 345 678' }), ['BK-JANE', 'BK-JANE-OLD']);
  assert.deepEqual(await ids({ phone: '+61412345678' }), ['BK-JANE', 'BK-JANE-OLD']);
  assert.deepEqual(await ids({ email: 'JANE@EXAMPLE' }), ['BK-JANE', 'BK-JANE-OLD']);
  assert.deepEqual(await ids({ address: 'foo st' }), ['BK-JANE']);
  assert.deepEqual(await ids({ suburb: 'braddon' }), ['BK-JANE-2']);
  assert.deepEqual(await ids({ source: ['facebook-lead-ad'] }), ['BK-NULLS']);
  assert.deepEqual(await ids({ status: ['cold'] }), ['BK-COLD']);
  assert.deepEqual(await ids({ query: 'jane ainslie' }), ['BK-JANE']);
  assert.deepEqual(await ids({ notesContains: 'gate code' }), ['BK-JANE']);
  assert.deepEqual(await ids({ query: 'paid cash' }), ['BK-JANE'], 'private admin notes searchable');
  assert.deepEqual(await ids({ createdFrom: '2026-04-01', createdTo: '2026-04-01' }), ['BK-JANE-OLD']);
  assert.deepEqual(await ids({ deleted: 'only' }), ['BK-DELETED']);
  // wildcard / injection-looking input is treated as text
  assert.deepEqual(await ids({ query: "%' OR 1=1; DROP TABLE bookings; --" }), []);
  assert.deepEqual(await ids({ name: '_' }), []);
  assert.ok(Number((await ownerExec(`SELECT count(*)::int AS n FROM bookings`))[0].n) > 0, 'bookings table intact');
});

test('LARP demo rows never appear', async () => {
  const all = await tool('search_bookings', { query: 'Fake' });
  assert.equal(all.data.total, 0);
  assert.equal((await tool('get_booking', { id: 'LARP-1' })).isError, true);
  const inv = await tool('list_invoices', { pageSize: 100 });
  assert.ok(!inv.data.items.some((i: any) => i.id.startsWith('LARP-')));
  const overview = await tool('get_report', { report: 'overview' });
  assert.ok(overview.data.revenue.total < 99999);
});

test('null (never recorded) and "" (saved blank) are preserved distinctly', async () => {
  const b = (await tool('get_booking', { id: 'BK-NULLS' })).data.booking;
  assert.equal(b.email, '');
  assert.equal(b.notes, null);
  assert.equal(b.quoteAmount, null);
  const jane = (await tool('get_booking', { id: 'BK-JANE' })).data.booking;
  assert.equal(jane.feedbackText, null);
  assert.equal(jane.feedbackStars, 5);
});

test('get_booking returns EVERY bookings column, original notes, and all linked records', async () => {
  const r = await tool('get_booking', { id: 'BK-JANE' });
  const b = r.data.booking;
  for (const col of await columns('bookings')) assert.ok(camel(col) in b, `bookings.${col} missing from get_booking`);
  assert.equal(b.notes, 'Gate code 4321, dog in backyard');
  assert.equal(b.adminNotes, 'Prefers SMS. Paid cash last time.');
  assert.equal(b.computed.thankYouPageUrl, `${BASE}/thanks/bk_tokjane`);
  const l = r.data.linked;
  assert.equal(l.quotes[0].number, 'Q1000');
  assert.equal(l.recurringPlans[0].id, 'RJ-1');
  assert.equal(l.group.title, 'Ainslie street run');
  assert.equal(l.assignedSubcontractor.name, 'Sub Contractor');
  assert.ok(!('passwordHash' in l.assignedSubcontractor));
  assert.equal(l.photos.length, 1);
  assert.deepEqual(l.otherRecordsForSameCustomer.map((o: any) => o.id), ['BK-JANE-OLD']);
  assert.ok(l.activityHistory.items.some((a: any) => a.id === 'ACT-1'));
  assert.ok(l.activityHistory.items.some((a: any) => a.id === 'ACT-2'), 'quote activity linked');
});

test('quotes: line items, discounts, exclusions, totals, tax note, inferred acceptance, public link', async () => {
  const q = (await tool('get_quote', { idOrNumber: 'Q1000' })).data.quote;
  for (const col of await columns('quotes')) assert.ok(camel(col) in q, `quotes.${col} missing`);
  assert.equal(q.computed.total, 350);
  assert.equal(q.computed.subtotalBeforeDiscounts, 450);
  assert.equal(q.computed.discountTotal, -100);
  assert.equal(q.computed.storedAmountMatchesLines, true);
  assert.deepEqual(q.computed.lineItems.map((l: any) => l.amount), [300, 100, 50, -100]);
  assert.match(q.scope, /Excludes hard water/);
  assert.equal(q.computed.tax.gstCharged, 0);
  assert.equal(q.computed.acceptance.state, 'pending');
  assert.equal(q.computed.publicUrl, `${BASE}/quote/qt_tokjane`);
});

test('invoices + payments: every column, balances, payment history, view log', async () => {
  const r = (await tool('get_invoice', { idOrNumber: 'GB1044' })).data;
  for (const col of await columns('invoices')) assert.ok(camel(col) in r.invoice, `invoices.${col} missing`);
  assert.equal(r.invoice.computed.amountPaid, 200);
  assert.equal(r.invoice.computed.outstandingBalance, 0);
  assert.equal(r.invoice.items[0].serviceAddress, '99 Old Rd');
  assert.equal(r.viewSessions[0].ip, '203.0.113.5');
  assert.ok(r.paymentHistory.events.some((e: any) => e.event === 'invoice_marked_paid' && e.method === 'cash'));
  assert.equal(r.linkedBookings[0].id, 'BK-JANE-OLD');
  const overdue = await tool('list_invoices', { paymentState: 'overdue' });
  assert.deepEqual(overdue.data.items.map((i: any) => i.number), ['GB1045']);
  assert.equal(overdue.data.items[0].computed.outstandingBalance, 275);
  const pays = await tool('list_payments', {});
  const kinds = new Set(pays.data.items.map((p: any) => p.kind));
  assert.ok(kinds.has('invoice_paid') && kinds.has('booking_marked_paid'));
  assert.ok(!pays.data.items.some((p: any) => String(p.bookingId ?? p.invoiceId).startsWith('LARP')));
});

test('schedule uses Australia/Sydney dates across the daylight-saving change', async () => {
  const day = async (d: string) => (await tool('list_schedule', { from: d, to: d })).data.items.map((i: any) => i.booking.id);
  assert.deepEqual(await day('2026-10-04'), ['BK-DST-A'], '00:30 AEST on 4 Oct (UTC 3 Oct 14:30)');
  assert.deepEqual(await day('2026-10-05'), ['BK-DST-B'], '00:30 AEDT on 5 Oct (UTC 4 Oct 13:30)');
  const wk = await tool('list_schedule', { from: '2026-10-01', to: '2026-10-07' });
  assert.equal(wk.data.total, 3);
  const qv = wk.data.items.find((i: any) => i.booking.id === 'BK-QV');
  assert.equal(qv.visitType, 'quote_visit');
  assert.equal(qv.start.time, '10:00');
  assert.equal(qv.start.utcOffset, '+11:00');
  assert.equal(qv.end.time, '11:00');
  const jobs = await tool('list_schedule', { from: '2026-10-01', to: '2026-10-07', visitType: 'jobs' });
  assert.deepEqual(jobs.data.items.map((i: any) => i.booking.id), ['BK-DST-A', 'BK-DST-B']);
  const req = await tool('list_schedule', { from: '2026-10-07', to: '2026-10-07', kind: 'requested_unscheduled' });
  assert.deepEqual(req.data.items.map((i: any) => i.booking.id), ['BK-REQ']);
  const rec = await tool('list_schedule', { from: '2026-10-01', to: '2026-12-31', kind: 'recurring_projected' });
  assert.deepEqual(rec.data.items.map((v: any) => v.date), ['2026-10-15', '2026-11-15', '2026-12-15']);
  const bad = await tool('list_schedule', { from: '2026-02-30', to: '2026-03-01' });
  assert.equal(bad.isError, true);
});

test('customer history groups records by phone/email and says why', async () => {
  const h = (await tool('get_customer_history', { bookingId: 'BK-JANE' })).data;
  assert.deepEqual(h.bookings.items.map((b: any) => b.id).sort(), ['BK-JANE', 'BK-JANE-OLD']);
  assert.ok(h.bookings.items.find((b: any) => b.id === 'BK-JANE-OLD').matchedOn.includes('phone'));
  assert.equal(h.recurringPlans[0].id, 'RJ-1');
  assert.deepEqual(h.invoices.map((i: any) => i.number), ['GB1044']);
  assert.deepEqual(h.quotes.map((q: any) => q.number), ['Q1000']);
});

test('search_everything surfaces multiple people with the same name for disambiguation', async () => {
  const r = (await tool('search_everything', { query: 'Jane' })).data;
  const names = r.bookings.items.map((b: any) => `${b.name}/${b.suburb}`);
  assert.ok(names.includes('Jane Citizen/Ainslie') && names.includes('Jane Smith/Braddon'));
  assert.equal(r.bookings.total, 3);
});

test('reports: quoted-not-booked, owed, overview, business, site traffic', async () => {
  const qnb = (await tool('get_report', { report: 'quoted_not_booked' })).data;
  assert.deepEqual(qnb.items.map((i: any) => i.booking.id).sort(), ['BK-COLD', 'BK-JANE']);
  const owed = (await tool('get_report', { report: 'owed' })).data;
  assert.deepEqual(owed.items.map((i: any) => i.kind).sort(), ['completed_unpaid_booking', 'unpaid_sent_invoice']);
  const ov = (await tool('get_report', { report: 'overview' })).data;
  assert.equal(ov.owed.value, 275);
  assert.equal(ov.revenue.total, 200);
  const biz = (await tool('get_report', { report: 'business' })).data;
  assert.equal(biz.invoices.overdueCount, 1);
  const site = (await tool('get_report', { report: 'site_traffic', days: 30 })).data;
  assert.equal(site.pageViews, 2, 'larp page view excluded');
  for (const r of ['revenue_by_month', 'pipeline']) assert.equal((await tool('get_report', { report: r })).isError, false, r);
});

test('settings, plans, activity, FB status, coverage tools all respond', async () => {
  const s = (await tool('get_business_settings')).data;
  assert.equal(s.appSettings.squareSurchargePercent, 2.2);
  assert.equal(s.appSettings.notificationsEnabled, false);
  assert.ok(!JSON.stringify(s).includes('SECRET-HASH-MUST-NOT-LEAK'));
  assert.ok(!JSON.stringify(s).includes('VAULT-SECRET'));
  const plan = (await tool('get_recurring_plan', { id: 'RJ-1' })).data;
  for (const col of await columns('recurring_jobs')) assert.ok(camel(col) in plan.plan, `recurring_jobs.${col} missing`);
  assert.deepEqual(plan.generatedBookings.map((b: any) => b.id), ['BK-JANE']);
  const act = (await tool('list_activity', { type: 'vault.' })).data;
  assert.equal(act.items[0].summary, 'Vault item saved', 'vault label redacted');
  assert.ok(!JSON.stringify(act).includes('Square token'));
  const fb = (await tool('get_facebook_lead_sync_status')).data;
  assert.equal(fb.importedLeads.totalNotDeleted, 1);
  assert.equal(fb.dismissedLeads.count, 1);
  const cov = (await tool('describe_data_coverage')).data;
  assert.ok(cov.knownGaps.length > 0);
});

test('photos: only signed expiring links; raw storage URL never returned; link checks enforced', async () => {
  const r = await tool('get_photo_links', { bookingId: 'BK-JANE' });
  assert.ok(!r.text.includes('raw-secret-path'), 'raw blob URL hidden');
  const link = new URL(r.data.photos[0].computed.viewUrl);
  assert.equal(link.pathname, '/api/mcp-files/photo');
  const t = link.searchParams.get('t')!;
  // tampered
  assert.equal((await handlePhoto(new Request(`${BASE}/api/mcp-files/photo?t=${encodeURIComponent(t.slice(0, -2) + 'xx')}`))).status, 403);
  // expired
  const expired = signBlob('file-link', { id: 'PH-1', exp: Math.floor(Date.now() / 1000) - 1 }, process.env.MCP_TOKEN_SECRET!);
  assert.equal((await handlePhoto(new Request(`${BASE}/api/mcp-files/photo?t=${encodeURIComponent(expired)}`))).status, 410);
  // a signed link for a photo whose stored URL is NOT Vercel Blob is never fetched
  await ownerExec(`INSERT INTO booking_photos (id, booking_id, type, url) VALUES ('PH-EVIL', 'BK-JANE', 'after', 'http://169.254.169.254/latest/meta-data')`);
  const evil = signBlob('file-link', { id: 'PH-EVIL', exp: Math.floor(Date.now() / 1000) + 60 }, process.env.MCP_TOKEN_SECRET!);
  assert.equal((await handlePhoto(new Request(`${BASE}/api/mcp-files/photo?t=${encodeURIComponent(evil)}`))).status, 404);
  await ownerExec(`DELETE FROM booking_photos WHERE id = 'PH-EVIL'`);
});

test('database-level read-only: the tool role cannot write, read the vault, or read password hashes', async () => {
  const db = getReadDb('unused-in-tests');
  await assert.rejects(readOne(db, `INSERT INTO bookings (id, name, phone, service, property_type) VALUES ('X', 'x', 'x', 'x', 'x')`), /read-only|permission denied/);
  await assert.rejects(readOne(db, `UPDATE bookings SET name = 'hacked'`), /read-only|permission denied/);
  await assert.rejects(readOne(db, `SELECT * FROM vault_items`), /permission denied/);
  await assert.rejects(readOne(db, `SELECT password_hash FROM guests`), /permission denied/);
  await assert.rejects(readOne(db, `SELECT * FROM mcp_audit_log`), /permission denied/);
  await assert.rejects(readOne(db, `CREATE TABLE evil (x int)`), /read-only|permission denied/);
  // Even with READ ONLY off, the role itself has no write grant:
  await ownerExec('SET ROLE mcp_readonly');
  try {
    await assert.rejects(ownerExec(`INSERT INTO bookings (id, name, phone, service, property_type) VALUES ('X', 'x', 'x', 'x', 'x')`), /permission denied/);
  } finally {
    await ownerExec('RESET ROLE');
  }
  await assertReadOnlyRole(db); // passes for the real role
});

test('runtime self-check refuses to serve if the role is ever given write access', async () => {
  const db = getReadDb('unused-in-tests');
  await ownerExec(`GRANT INSERT ON bookings TO mcp_readonly`);
  try {
    setMcpDbsForTesting((globalThis as any).__MCP_TEST_DBS__); // reset cached check
    await assert.rejects(assertReadOnlyRole(db), /write privileges/);
    const r = await tool('search_bookings', { query: 'jane' });
    assert.equal(r.isError, true);
    assert.ok(!r.text.includes('Jane'));
  } finally {
    await ownerExec(`REVOKE INSERT ON bookings FROM mcp_readonly`);
    setMcpDbsForTesting((globalThis as any).__MCP_TEST_DBS__);
  }
  await ownerExec(`GRANT SELECT ON vault_items TO mcp_readonly`);
  try {
    setMcpDbsForTesting((globalThis as any).__MCP_TEST_DBS__);
    await assert.rejects(assertReadOnlyRole(db), /vault/);
  } finally {
    await ownerExec(`REVOKE SELECT ON vault_items FROM mcp_readonly`);
    setMcpDbsForTesting((globalThis as any).__MCP_TEST_DBS__);
  }
});

test('no tool output anywhere contains secrets', async () => {
  const outputs = await Promise.all([
    tool('get_business_settings'), tool('get_booking', { id: 'BK-JANE' }), tool('list_activity', { pageSize: 100 }),
    tool('search_bookings', { pageSize: 100 }), tool('get_customer_history', { bookingId: 'BK-JANE' }),
  ]);
  const dump = outputs.map(o => o.text).join('\n');
  for (const s of ['SECRET-HASH-MUST-NOT-LEAK', 'VAULT-SECRET-MUST-NOT-LEAK', 'raw-secret-path', process.env.MCP_TOKEN_SECRET!, token]) {
    assert.ok(!dump.includes(s), `leaked ${s.slice(0, 12)}…`);
  }
});

test('coverage map accounts for every table in the schema', async () => {
  const tables = (await ownerExec(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).map(r => String(r.table_name));
  const unmapped = tables.filter(t => !(t in TABLE_COVERAGE) && !(t in EXCLUDED_TABLES));
  assert.deepEqual(unmapped, [], 'every table is either covered or explicitly excluded');
  // and every covered table is actually readable by the role
  for (const t of Object.keys(TABLE_COVERAGE)) {
    const priv = await ownerExec(`SELECT has_table_privilege('mcp_readonly', $1, 'SELECT') OR has_any_column_privilege('mcp_readonly', $1, 'SELECT') AS ok`, [t]);
    assert.equal(priv[0].ok, true, `${t} not readable by mcp_readonly`);
  }
});
