import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import twilio from 'twilio';
import { addDays, blankInvoiceInput, BUSINESS_DEFAULTS, type Invoice } from '../../src/lib/invoice';
import { emptyQuoteDraft, type Quote } from '../../src/lib/quote';
import { interpretSms, invoiceMilestone, overlapsBooking, quoteEligible } from '../../src/lib/smartActionRules';
import { smartSmsIntent } from '../../src/lib/smartActionAi';
import { sydneyLocalToIso, sydneyToday } from '../../src/lib/mcp/time';
import type { Booking } from '../../src/lib/db';

test('detects invoice thresholds and suppresses ineligible invoices', () => {
  const invoice = { status: 'sent', total: 480, notes: '' } as Invoice;
  const job = { paid: false, adminNotes: '' } as Booking;
  for (const [days, expected] of [[6, 0], [7, 7], [13, 7], [14, 14], [29, 14], [30, 30]]) {
    assert.equal(invoiceMilestone(invoice, [job], days), expected);
  }
  assert.equal(invoiceMilestone({ ...invoice, status: 'paid' }, [job], 40), 0);
  assert.equal(invoiceMilestone({ ...invoice, status: 'cancelled' }, [job], 40), 0);
  assert.equal(invoiceMilestone({ ...invoice, reminderHold: true }, [job], 40), 0);
  assert.equal(invoiceMilestone(invoice, [{ ...job, adminNotes: 'Invoice disputed' }], 40), 0);
});

test('quote follow-ups require an unbooked, unaccepted in-window quote', () => {
  const quote = { status: 'sent', sentAt: '2026-11-15T01:00:00Z', validUntil: '2026-12-15' } as Quote;
  const job = { status: 'quoted', adminNotes: '' } as Booking;
  assert.equal(quoteEligible(quote, job, '2026-11-22'), true);
  assert.equal(quoteEligible(quote, job, '2026-11-26'), false);
  assert.equal(quoteEligible(quote, { ...job, status: 'cancelled' }, '2026-11-22'), false);
  assert.equal(quoteEligible(quote, { ...job, scheduledAt: '2026-11-24' }, '2026-11-22'), false);
  assert.equal(quoteEligible({ ...quote, acceptedAt: '2026-11-18' }, job, '2026-11-22'), false);
});

test('calendar overlap respects slot endpoints and ignores cancelled jobs', () => {
  const job = { id: 'other', status: 'confirmed', scheduledAt: '2026-11-22T00:00:00Z', scheduledEnd: '2026-11-22T02:00:00Z' } as Booking;
  assert.equal(overlapsBooking([job], 'target', '2026-11-22T01:00:00Z', '2026-11-22T02:30:00Z'), true);
  assert.equal(overlapsBooking([job], 'target', '2026-11-22T02:00:00Z', '2026-11-22T03:00:00Z'), false);
  assert.equal(overlapsBooking([{ ...job, status: 'cancelled' }], 'target', '2026-11-22T01:00:00Z', '2026-11-22T02:30:00Z'), false);
});

test('ambiguous requests produce clarification and Gemini outages fall back', async context => {
  const at = '2026-11-22T00:00:00Z';
  assert.deepEqual(interpretSms('Could we move to Thursday or Friday at 10 am?', at), { intent: 'reschedule' });
  assert.deepEqual(interpretSms('Could we move to next Thursday at 10 am?', at), { intent: 'reschedule' });
  assert.deepEqual(interpretSms('Could we move my booking on Thursday at 10 am?', at), { intent: 'reschedule' });
  assert.equal(interpretSms('Could we move to Thursday at 10 am?', at).localStart, '2026-11-26T10:00');
  const oldKey = process.env.GEMINI_API_KEY;
  const oldEnabled = process.env.SMART_ACTIONS_GEMINI_ENABLED;
  process.env.GEMINI_API_KEY = 'fixture';
  process.env.SMART_ACTIONS_GEMINI_ENABLED = 'true';
  try {
    const request = context.mock.fn<typeof fetch>(async (_url, options) => {
      assert.doesNotMatch(String(options?.body), /Catherine|0400123456|Canberra/);
      return new Response(null, { status: 503 });
    });
    assert.deepEqual(await smartSmsIntent('Catherine 0400123456 Canberra: move to tomorrow at 10 am?', at, request),
      { intent: 'reschedule', localStart: '2026-11-23T10:00' });
    assert.equal(request.mock.callCount(), 1);
  } finally {
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
    if (oldEnabled === undefined) delete process.env.SMART_ACTIONS_GEMINI_ENABLED; else process.env.SMART_ACTIONS_GEMINI_ENABLED = oldEnabled;
  }
});

test('Smart Action approval, dismissal and partial bulk failure use the existing outbox safely', async context => {
  const cwd = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'gb-smart-actions-'));
  process.chdir(scratch);
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) delete process.env[key];
  process.env.TWILIO_ACCOUNT_SID = 'AC' + '1'.repeat(32);
  process.env.TWILIO_AUTH_TOKEN = 'fixture';
  process.env.TWILIO_SMS_FROM = '+61485000000';
  process.env.TWILIO_SMS_PUBLIC_URL = 'https://example.test';
  process.env.TWILIO_SMS_ENABLED = 'true';
  process.env.TWILIO_SMS_AUTOMATION = 'false';
  process.env.SMART_ACTIONS_GEMINI_ENABLED = 'false';

  const submitted: Array<{ To: string; Body: string }> = [];
  context.mock.method(twilio.RequestClient.prototype, 'request', async (options: { data: { To: string; Body: string } }) => {
    submitted.push(options.data);
    if (options.data.To === '+61400111222') return { statusCode: 400, body: { code: 21614, message: 'Fixture failure' } };
    return { statusCode: 201, body: { sid: 'SM' + String(submitted.length).padStart(32, '0'), status: 'sent' } };
  });

  try {
    const db = await import('../../src/lib/db');
    const service = await import('../../src/lib/smartActions');
    const today = sydneyToday();
    const sevenDaysAgo = addDays(today, -7) + 'T01:00:00Z';
    const job = async (name: string, phone: string, evidence = '') => db.addBooking({
      name, phone, email: '', address: '1 Test Street', suburb: 'Test', service: 'window-washing',
      propertyType: 'residential', preferredDate: '', preferredTime: '', notes: '', quoteAmount: null, adminNotes: evidence,
    });
    const a = await job('Alex Test', '+61400111111', 'SMS marketing consent: Signed service form');
    await new Promise(resolve => setTimeout(resolve, 2));
    const b = await job('Blake Test', '+61400111222', 'SMS marketing consent: Email from customer');
    await new Promise(resolve => setTimeout(resolve, 2));
    const c = await job('Casey Test', '+61400111333');
    for (const booking of [a, b, c]) {
      const quote = await db.createQuote({ ...emptyQuoteDraft(BUSINESS_DEFAULTS, today), bookingId: booking.id, billToName: booking.name, amount: 400 }, { syncBooking: false });
      await db.updateQuote(quote.id, { status: 'sent' });
      await db.updateQuote(quote.id, { sentAt: sevenDaysAgo });
      await db.insertSms({
        id: 'initial-' + booking.id, kind: 'quote', recordId: quote.id, direction: 'outbound', phone: booking.phone,
        body: 'Initial quote link', status: 'delivered', sid: 'fixture-' + booking.id,
        actor: 'system', createdAt: sevenDaysAgo, updatedAt: sevenDaysAgo,
      });
    }
    const invoice = await db.createInvoice({
      ...blankInvoiceInput(today), bookingId: c.id, bookingIds: [c.id], billToName: c.name,
      dueDate: addDays(today, -14), items: [{ description: 'Cleaning', date: today, detail: '', serviceAddress: '', amount: 480 }],
    });
    await db.updateInvoice(invoice.id, { status: 'sent' });
    const initial = (await service.listSmartActions()).actions;
    const reminder = initial.find(action => action.kind === 'invoice')!;
    assert.ok(reminder);
    await db.updateInvoice(invoice.id, { status: 'paid', paymentMethod: 'cash' });
    assert.equal((await service.respondToSmartAction(reminder.id, 'approve', reminder.preview, 'Liam'))?.status, 'expired');
    assert.equal(submitted.length, 0);

    await db.updateInvoice(invoice.id, { status: 'sent', paidAt: null });
    await db.updateBooking(c.id, { paid: false });
    const newReminder = (await service.listSmartActions()).actions.find(action => action.kind === 'invoice')!;
    assert.ok(newReminder);
    assert.equal((await service.respondToSmartAction(newReminder.id, 'dismiss', undefined, 'Liam'))?.status, 'dismissed');
    assert.equal((await service.listSmartActions()).actions.some(action => action.id === newReminder.id), false);

    const bulk = initial.find(action => action.kind === 'quote')!;
    assert.deepEqual(bulk.recipients.map(recipient => recipient.name).sort(), ['Alex Test', 'Blake Test']);
    assert.equal((await service.respondToSmartAction(bulk.id, 'approve', 'wrong', 'Liam'))?.status, 'expired');
    const responses = await Promise.all([
      service.respondToSmartAction(bulk.id, 'approve', bulk.preview, 'Liam'),
      service.respondToSmartAction(bulk.id, 'approve', bulk.preview, 'Lincoln'),
    ]);
    const finished = responses.find(result => result?.status === 'failed');
    assert.ok(finished);
    assert.deepEqual(finished.results.map(result => result.status).sort(), ['failed', 'submitted']);
    assert.equal(submitted.length, 2);
    for (const sent of submitted) assert.equal(sent.Body, bulk.recipients.find(recipient => recipient.phone === sent.To)?.message);
    await service.respondToSmartAction(bulk.id, 'approve', bulk.preview, 'Liam');
    assert.equal(submitted.length, 2);

    const date = addDays(today, 3);
    const before = sydneyLocalToIso(date + 'T09:00')!;
    const occupied = sydneyLocalToIso(date + 'T13:00')!;
    await db.updateBooking(a.id, { status: 'confirmed', scheduledAt: before, scheduledEnd: sydneyLocalToIso(date + 'T11:00')! });
    await db.updateBooking(b.id, { status: 'confirmed', scheduledAt: occupied, scheduledEnd: sydneyLocalToIso(date + 'T15:00')! });
    const receive = async (suffix: number, text: string) => db.insertSms({
      id: 'incoming-' + suffix, kind: 'reply', recordId: a.id, direction: 'inbound', phone: a.phone,
      body: text, status: 'received', actor: 'customer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await receive(1, 'Could we move to ' + date + ' at 13:00?');
    assert.equal((await service.listSmartActions()).actions.some(action => action.kind === 'reschedule'), false);
    assert.equal((await service.listSmartActions()).actions.some(action => action.kind === 'clarify'), true);
    await receive(2, 'Could we move to ' + date + ' at 16:00?');
    const move = (await service.listSmartActions()).actions.find(action => action.kind === 'reschedule')!;
    assert.ok(move);
    const moved = await service.respondToSmartAction(move.id, 'approve', move.preview, 'Liam');
    assert.equal(moved?.status, 'completed');
    assert.equal((await db.getBookingById(a.id))?.scheduledAt, sydneyLocalToIso(date + 'T16:00'));
    assert.equal(submitted.length, 3);
    assert.equal(submitted.at(-1)?.Body, move.recipients[0].message);
    await service.respondToSmartAction(move.id, 'approve', move.preview, 'Liam');
    assert.equal(submitted.length, 3);

    await db.updateInvoice(invoice.id, { dueDate: addDays(today, -30) });
    const nextMilestone = (await service.listSmartActions()).actions.find(action => action.kind === 'invoice')!;
    assert.ok(nextMilestone);
    assert.equal((await service.respondToSmartAction(nextMilestone.id, 'approve', nextMilestone.preview, 'Liam'))?.status, 'completed');
    assert.equal(submitted.at(-1)?.Body, nextMilestone.recipients[0].message);
    assert.equal((await service.listSmartActions()).actions.some(action => action.kind === 'invoice'), false);
  } finally {
    process.chdir(cwd);
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
  }
});
