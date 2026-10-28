// Write tools (MCP_WRITES_ENABLED=true): they go through src/lib/db.ts, which
// with no DATABASE_URL uses local JSON files under process.cwd()/data — so the
// test runs from a throwaway temp folder and never touches the repo's data/.
// Run: npm run test:mcp

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repoCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-writes-'));
process.chdir(tmp); // before db.ts is loaded (it resolves data/ paths at import)

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let h: typeof import('./harness');
let token = '';

before(async () => {
  h = await import('./harness');
  h.configureEnv({ MCP_WRITES_ENABLED: 'true' });
  await h.setupDb();
  await h.seed();
  token = (await h.fullLogin()).accessToken;
});
after(() => {
  process.chdir(repoCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await (await h.rpc(token, 'tools/call', { name, arguments: args })).json();
  const r = res.result;
  return { isError: !!r?.isError, text: r?.content?.[0]?.text as string, data: r?.structuredContent as any };
}

test('write tools are registered (and only when enabled), never read-only, no delete tool', async () => {
  const tools = (await (await h.rpc(token, 'tools/list')).json()).result.tools as any[];
  const names = tools.map(t => t.name);
  for (const n of ['create_booking', 'update_booking', 'schedule_booking', 'create_quote', 'update_quote', 'create_invoice', 'update_invoice_status', 'make_recurring_customer', 'create_recurring_job', 'book_next_recurring_visit']) {
    assert.ok(names.includes(n), n);
    assert.equal(tools.find(t => t.name === n).annotations.readOnlyHint, false, n);
  }
  assert.ok(!names.some(n => /delete|remove/.test(n)));
  assert.ok(names.includes('search_bookings'), 'read tools still there');
});

test('full flow: booking → calendar → quote (single + packages) → invoice → paid → recurring', async () => {
  const created = await call('create_booking', { name: 'Zed Writer', phone: '0400 111 222', suburb: 'Ainslie', address: '1 Test St', services: ['window-washing'] });
  assert.equal(created.isError, false, created.text);
  const id = created.data.booking.id as string;
  assert.equal(created.data.booking.status, 'uncontacted');

  const upd = await call('update_booking', { id, quoteAmount: 400, addAdminNote: 'Gate code 1234' });
  assert.equal(upd.isError, false, upd.text);
  assert.equal(upd.data.booking.quoteAmount, 400);
  assert.match(upd.data.booking.adminNotes, /via ChatGPT\] Gate code 1234$/);
  const upd2 = await call('update_booking', { id, addAdminNote: 'Dog in yard' });
  assert.match(upd2.data.booking.adminNotes, /Gate code 1234[\s\S]*Dog in yard/, 'notes append, never replace');

  // 9:30 Sydney on 5 Nov 2026 is AEDT (+11) → 22:30 UTC the day before
  const sch = await call('schedule_booking', { id, start: '2026-11-05T09:30', durationMinutes: 90 });
  assert.equal(sch.isError, false, sch.text);
  assert.equal(sch.data.booking.scheduledAt, '2026-11-04T22:30:00.000Z');
  assert.equal(sch.data.booking.status, 'confirmed');

  const other = await call('create_booking', { name: 'Clash Person', scheduledStart: '2026-11-05T10:00' });
  assert.equal(other.isError, false, other.text);
  const clash = await call('schedule_booking', { id, start: '2026-11-05T09:30' });
  assert.equal(clash.isError, true);
  assert.match(clash.text, /overlaps 1 other booking/);
  const forced = await call('schedule_booking', { id, start: '2026-11-05T09:30', allowOverlap: true });
  assert.equal(forced.isError, false, forced.text);

  const gap = await call('schedule_booking', { id, start: '2026-10-04T02:30' }); // DST gap in Sydney
  assert.equal(gap.isError, true);

  const q = await call('create_quote', {
    bookingId: id,
    items: [{ key: 'window-washing-outside', amount: 300 }, { key: 'window-washing-inside', amount: 150 }],
    otherLines: [{ description: 'Meta ads discount', amount: -100 }],
    status: 'sent',
  });
  assert.equal(q.isError, false, q.text);
  assert.equal(q.data.quote.amount, 350);
  assert.match(q.data.customerLink, /\/quote\/qt_/);

  const pk = await call('create_quote', {
    bookingId: id, quoteType: 'packages', completePrice: 400,
    items: [{ key: 'window-washing-outside', amount: 0 }, { key: 'window-washing-inside', amount: 0 }],
    otherLines: [{ description: 'Facebook discount', amount: -50 }],
  });
  assert.equal(pk.isError, false, pk.text);
  assert.deepEqual(pk.data.quote.packagePrices, { essential: 30000, complete: 40000, premium: 70000 });

  const badPk = await call('create_quote', { bookingId: id, quoteType: 'packages', completePrice: 400, items: [{ key: 'solar-panel-cleaning', amount: 100 }] });
  assert.equal(badPk.isError, true);

  const qs = await call('update_quote', { idOrNumber: q.data.quote.number, notes: 'Thanks!' });
  assert.equal(qs.isError, false, qs.text);
  assert.equal(qs.data.quote.notes, 'Thanks!');

  const inv = await call('create_invoice', { bookingId: id });
  assert.equal(inv.isError, false, inv.text);
  assert.equal(inv.data.invoice.billToName, 'Zed Writer');
  assert.deepEqual(inv.data.invoice.bookingIds, [id]);
  assert.ok(inv.data.invoice.total > 0);

  const noMethod = await call('update_invoice_status', { idOrNumber: inv.data.invoice.number, status: 'paid' });
  assert.equal(noMethod.isError, true);
  const paid = await call('update_invoice_status', { idOrNumber: inv.data.invoice.number, status: 'paid', paymentMethod: 'bank_transfer' });
  assert.equal(paid.isError, false, paid.text);
  assert.equal(paid.data.invoice.status, 'paid');
  assert.equal(paid.data.invoice.paymentMethod, 'bank_transfer');

  const rec = await call('make_recurring_customer', { bookingId: id, frequency: 'quarterly', visitPrice: 400 });
  assert.equal(rec.isError, false, rec.text);
  assert.equal(rec.data.profile.discount, 75);
  assert.match(rec.data.portal.pin, /^\d{4}$/);
  const profileId = rec.data.profile.id as string;

  const job = await call('create_recurring_job', { profileId, date: '2027-02-10', startTime: '09:00' });
  assert.equal(job.isError, false, job.text);
  assert.equal(job.data.booking.quoteAmount, 325, '$400 less $75 plan discount');
  assert.equal(job.data.booking.recurringId, profileId);

  const next = await call('book_next_recurring_visit', { profileId });
  assert.equal(next.isError, false, next.text);
  assert.equal(next.data.booking.recurringId, profileId);
});

test('unknown ids are refused cleanly, nothing invented', async () => {
  for (const [name, args] of [
    ['update_booking', { id: 'BK-nope', paid: true }],
    ['schedule_booking', { id: 'BK-nope', start: '2026-11-05T09:00' }],
    ['create_quote', { bookingId: 'BK-nope', otherLines: [{ description: 'x', amount: 1 }] }],
    ['update_invoice_status', { idOrNumber: 'GB-nope', status: 'sent' }],
    ['create_recurring_job', { profileId: 'RJ-nope', date: '2027-01-01' }],
  ] as const) {
    const r = await call(name, args as Record<string, unknown>);
    assert.equal(r.isError, true, name);
    assert.match(r.text, /No |not found/i, name);
  }
});

test('writes stay off unless MCP_WRITES_ENABLED=true', async () => {
  h.configureEnv({ MCP_WRITES_ENABLED: undefined });
  const t2 = (await h.fullLogin()).accessToken;
  const tools = (await (await h.rpc(t2, 'tools/list')).json()).result.tools as any[];
  assert.ok(!tools.some(t => t.name === 'create_booking'));
  h.configureEnv({ MCP_WRITES_ENABLED: 'true' });
});
