// Stage 1 fixes from the Atlas tests:
//  - "Q-1114" / "q 1114" / "1114" find quote Q1114 (Atlas reported Q1114 found,
//    then not found, because it looked up "Q-1114");
//  - connector quotes never change confirmed/paid bookings or upcoming quote
//    visits (the admin sync overwrote price + status on every quote);
//  - create_* tools are retry-safe with requestId and report the saved record;
//  - the activity log says who made the change (chatgpt vs atlas).
// All write records are disposable TEST records in a throwaway data folder.
// Run: npm run test:mcp

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

const repoCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stage1-'));
process.chdir(tmp); // db.ts resolves data/ (the write store) from cwd at import

/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-explicit-any */
let h: typeof import('./harness');
let oauth: typeof import('../../src/lib/mcp/oauth');
let db: typeof import('../../src/lib/db');
let owner = '';
let atlas = '';

const VAPI_ID = 'gbvapi_stage1test';
const VAPI_SECRET = 'stage1-test-secret-0123456789abcdefghijklmnop';

before(async () => {
  h = await import('./harness');
  oauth = await import('../../src/lib/mcp/oauth');
  db = await import('../../src/lib/db');
  h.configureEnv({
    MCP_WRITES_ENABLED: 'true',
    MCP_VAPI_CLIENT_ID: VAPI_ID,
    MCP_VAPI_CLIENT_SECRET_HASH: `sha256:${createHash('sha256').update(VAPI_SECRET).digest('hex')}`,
  });
  await h.setupDb();
  await h.seed();
  owner = (await h.fullLogin()).accessToken;
  const res = await oauth.token(h.req('/api/oauth/token', { method: 'POST', form: { grant_type: 'client_credentials', client_id: VAPI_ID, client_secret: VAPI_SECRET } }));
  atlas = (await res.json()).access_token;
});
after(() => {
  process.chdir(repoCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = (token: string, name: string, args: Record<string, unknown>) => h.callTool(token, name, args);
const rid = () => `test-${randomUUID()}`;

test('Q1114 bug: "Q-1000", "q 1000", "#1000" and "1000" all find quote Q1000 (read tools)', async () => {
  for (const form of ['Q1000', 'Q-1000', 'q 1000', '#1000', '1000', ' Q - 1000 ']) {
    const r = await call(atlas, 'get_quote', { idOrNumber: form });
    assert.equal(r.isError, false, `${form}: ${r.text}`);
    assert.equal(r.data.quote.number, 'Q1000', form);
  }
  const listed = await call(atlas, 'list_quotes', { query: 'Q-1000' });
  assert.deepEqual(listed.data.items.map((q: any) => q.number), ['Q1000']);
  const inv = await call(owner, 'get_invoice', { idOrNumber: 'GB-1044' });
  assert.equal(inv.isError, false, inv.text);
  assert.equal(inv.data.invoice.number, 'GB1044');
  const missing = await call(atlas, 'get_quote', { idOrNumber: 'Q-9999' });
  assert.equal(missing.isError, true, 'a genuinely missing quote still says not found');
});

test('workflow: TEST customer → booking → itemised quote with discount → draft invoice, each re-read and checked', async () => {
  // 1. customer + booking (retry-safe)
  const r1 = rid();
  const b = await call(owner, 'create_booking', {
    name: 'TEST Disposable Customer', phone: '0400 000 999', suburb: 'Testville', address: '1 Test St',
    services: ['window-washing'], adminNotes: 'TEST record — safe to delete', requestId: r1,
  });
  assert.equal(b.isError, false, b.text);
  assert.equal(b.data.verified.reReadFromDatabase, true);
  const bookingId = b.data.booking.id;

  // 2. calendar slot (Sydney time)
  const s = await call(owner, 'schedule_booking', { id: bookingId, start: '2026-12-03T09:00', durationMinutes: 90, visitType: 'job' });
  assert.equal(s.isError, false, s.text);
  assert.equal(s.data.booking.status, 'confirmed');
  assert.match(s.data.booking.scheduledSydney, /2026-12-03 09:00 \(AEDT/);

  // 3. itemised quote with a discount line — on a CONFIRMED booking
  const before = await db.getBookingById(bookingId);
  const q = await call(owner, 'create_quote', {
    bookingId, requestId: rid(), status: 'sent',
    items: [{ key: 'window-washing-outside', amount: 300 }, { key: 'window-washing-inside', amount: 120 }, { key: 'flyscreen-repair', amount: 40 }],
    otherLines: [{ description: 'TEST discount', amount: -60 }],
  });
  assert.equal(q.isError, false, q.text);
  assert.equal(q.data.quote.amount, 400);
  assert.deepEqual(q.data.verified, { reReadFromDatabase: true, totalAsCalculated: true, expectedTotal: 400, savedTotal: 400 });
  assert.deepEqual(q.data.bookingChanges.changed, [], 'confirmed booking untouched');
  const afterQuote = await db.getBookingById(bookingId);
  assert.equal(afterQuote!.status, 'confirmed');
  assert.equal(afterQuote!.quoteAmount ?? null, before!.quoteAmount ?? null, 'price not overwritten');
  assert.equal(afterQuote!.scheduledAt, before!.scheduledAt);

  // 4. edit the quote via the spoken number form
  const qn = q.data.quote.number as string;
  const e = await call(owner, 'update_quote', { idOrNumber: qn.replace('Q', 'Q-'), notes: 'TEST note' });
  assert.equal(e.isError, false, e.text);
  assert.equal(e.data.quote.notes, 'TEST note');
  assert.equal(e.data.quote.amount, 400, 'prices unchanged by note edits');

  // 5. draft invoice with a discount; total must equal its lines
  const inv = await call(owner, 'create_invoice', {
    bookingId, requestId: rid(),
    items: [{ description: 'TEST window cleaning', amount: 420 }, { description: 'TEST discount', amount: -20 }],
  });
  assert.equal(inv.isError, false, inv.text);
  assert.equal(inv.data.invoice.status, 'draft');
  assert.deepEqual(inv.data.verified, { reReadFromDatabase: true, totalEqualsLineItems: true, lineItemSum: 400, savedTotal: 400 });

  // 6. retrieve everything independently and check it matches
  const savedQuote = await db.getQuoteById(q.data.quote.id);
  const savedInvoice = await db.getInvoiceById(inv.data.invoice.id);
  assert.equal(savedQuote!.amount, 400);
  assert.deepEqual(savedInvoice!.bookingIds, [bookingId]);
  assert.equal(savedInvoice!.total, 400);
});

test('retries: same requestId returns the first record, never a duplicate; reuse for another tool is refused', async () => {
  const r = rid();
  const args = { name: 'TEST Retry Customer', phone: '0400 000 111', requestId: r };
  const first = await call(owner, 'create_booking', args);
  const second = await call(owner, 'create_booking', args);
  assert.equal(second.isError, false, second.text);
  assert.equal(second.data.duplicateRequest, true);
  assert.equal(second.data.booking.id, first.data.booking.id);
  const all = (await db.getBookings()).filter(b => b.name === 'TEST Retry Customer');
  assert.equal(all.length, 1, 'only one booking saved');

  const qr = rid();
  const quoteArgs = { bookingId: first.data.booking.id, items: [{ key: 'pressure-washing', amount: 200 }], requestId: qr };
  const q1 = await call(owner, 'create_quote', quoteArgs);
  const q2 = await call(owner, 'create_quote', quoteArgs);
  assert.equal(q2.data.quote.id, q1.data.quote.id);
  assert.equal((await db.getQuotes()).filter(q => q.bookingId === first.data.booking.id).length, 1);

  const clash = await call(owner, 'create_invoice', { bookingId: first.data.booking.id, items: [{ description: 'x', amount: 1 }], requestId: qr });
  assert.equal(clash.isError, true);
  assert.match(clash.text, /already used for create_quote/);

  // a failed create releases the requestId so a corrected retry can go through
  const bad = rid();
  const fail = await call(owner, 'create_quote', { bookingId: first.data.booking.id, requestId: bad });
  assert.equal(fail.isError, true);
  const ok = await call(owner, 'create_quote', { bookingId: first.data.booking.id, items: [{ key: 'pressure-washing', amount: 150 }], requestId: bad });
  assert.equal(ok.isError, false, ok.text);
});

test('quote → booking rules: drafts never change bookings; sent quotes only move open leads', async () => {
  const lead = await db.addBooking({ name: 'TEST Open Lead', email: '', phone: '0400 000 222', service: 'window-washing', propertyType: 'residential', address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '' } as any);
  const draft = await call(owner, 'create_quote', { bookingId: lead.id, items: [{ key: 'window-washing-outside', amount: 250 }] });
  assert.deepEqual(draft.data.bookingChanges.changed, []);
  let b = await db.getBookingById(lead.id);
  assert.equal(b!.status, 'uncontacted');
  assert.equal(b!.quoteAmount ?? null, null);

  const sent = await call(owner, 'update_quote', { idOrNumber: draft.data.quote.number, status: 'sent' });
  assert.deepEqual(sent.data.bookingChanges.changed, ['status', 'quoteAmount']);
  b = await db.getBookingById(lead.id);
  assert.equal(b!.status, 'quoted');
  assert.equal(b!.quoteAmount, 250);

  // upcoming quote visit: stays a quote visit
  const visit = await db.addBooking({ name: 'TEST Quote Visit', email: '', phone: '0400 000 333', service: 'window-washing', propertyType: 'residential', address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '', status: 'quote-booked', scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString() } as any);
  const vq = await call(owner, 'create_quote', { bookingId: visit.id, status: 'sent', items: [{ key: 'window-washing-outside', amount: 300 }] });
  assert.deepEqual(vq.data.bookingChanges.changed, []);
  assert.equal((await db.getBookingById(visit.id))!.status, 'quote-booked');

  // paid / completed job: untouched
  const done = await db.addBooking({ name: 'TEST Paid Job', email: '', phone: '0400 000 444', service: 'window-washing', propertyType: 'residential', address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '', status: 'completed', paid: true, quoteAmount: 500 } as any);
  await call(owner, 'create_quote', { bookingId: done.id, status: 'sent', items: [{ key: 'window-washing-outside', amount: 99 }] });
  const d = await db.getBookingById(done.id);
  assert.equal(d!.status, 'completed');
  assert.equal(d!.quoteAmount, 500);
});

test('admin Quote Maker behaviour is unchanged (createQuote still syncs by default)', async () => {
  const lead = await db.addBooking({ name: 'TEST Admin Path', email: '', phone: '0400 000 555', service: 'window-washing', propertyType: 'residential', address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '' } as any);
  const quote = await db.createQuote({ bookingId: lead.id, services: ['window-washing-outside'], extras: [], itemAmounts: { 'window-washing-outside': 180 }, otherLines: [], amount: 180 } as any);
  const b = await db.getBookingById(lead.id);
  assert.equal(quote.amount, 180);
  assert.equal(b!.status, 'quoted');
  assert.equal(b!.quoteAmount, 180);
});

test('activity log records who made the change: atlas for Vapi, chatgpt for the owner', async () => {
  const lead = await db.addBooking({ name: 'TEST Actor Check', email: '', phone: '0400 000 666', service: 'window-washing', propertyType: 'residential', address: '', suburb: '', preferredDate: '', preferredTime: '', notes: '' } as any);
  const viaAtlas = await call(atlas, 'create_quote', { bookingId: lead.id, items: [{ key: 'window-washing-outside', amount: 210 }] });
  assert.equal(viaAtlas.isError, false, viaAtlas.text);
  const viaOwner = await call(owner, 'update_quote', { idOrNumber: viaAtlas.data.quote.number, notes: 'TEST' });
  assert.equal(viaOwner.isError, false, viaOwner.text);
  const log = await db.getActivityLog(50);
  const created = log.find(a => a.type === 'quote.created' && (a.meta as any)?.quoteId === viaAtlas.data.quote.id);
  const updated = log.find(a => a.type === 'quote.updated' && (a.meta as any)?.quoteId === viaAtlas.data.quote.id);
  assert.equal(created?.actor, 'atlas');
  assert.match(created!.summary, /via Atlas/);
  assert.equal(updated?.actor, 'chatgpt');
});

test('permissions: a narrow Atlas token cannot create bookings or invoices; unauthenticated callers get nothing', async () => {
  const res = await oauth.token(h.req('/api/oauth/token', { method: 'POST', form: { grant_type: 'client_credentials', client_id: VAPI_ID, client_secret: VAPI_SECRET, scope: 'bookings.read quotes.read quotes.write' } }));
  const narrow = (await res.json()).access_token;
  const names = ((await (await h.rpc(narrow, 'tools/list')).json()).result.tools as any[]).map(t => t.name);
  for (const n of ['create_booking', 'schedule_booking', 'create_invoice', 'update_booking', 'get_invoice']) assert.ok(!names.includes(n), n);
  const anon = await h.rpc(null, 'tools/call', { name: 'search_bookings', arguments: { query: 'TEST' } });
  assert.equal(anon.status, 401);
});
