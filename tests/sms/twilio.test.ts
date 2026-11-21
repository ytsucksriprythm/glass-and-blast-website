import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import twilio from 'twilio';
import { australianMobile } from '../../src/lib/smsTypes';

test('Australian mobile formats normalize consistently', () => {
  for (const value of ['0400 123 456', '+61 (400) 123-456', '0061400123456', 'p:61400123456']) assert.equal(australianMobile(value), '+61400123456');
  for (const value of ['02 6000 0000', '+12025550123', '+614001234', '']) assert.equal(australianMobile(value), null);
});

test('signed Twilio callbacks, consent and outbox dedup work without customer sends', async context => {
  const cwd = process.cwd();
  const scratch = mkdtempSync(join(tmpdir(), 'gb-sms-'));
  process.chdir(scratch);
  for (const k of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) delete process.env[k];
  process.env.TWILIO_ACCOUNT_SID = 'AC' + '1'.repeat(32);
  process.env.TWILIO_AUTH_TOKEN = 'fixture-webhook-secret';
  process.env.TWILIO_SMS_FROM = '+61485000000';
  process.env.TWILIO_SMS_PUBLIC_URL = 'https://example.test';
  process.env.TWILIO_SMS_ENABLED = 'false';
  try {
    const db = await import('../../src/lib/db');
    const sms = await import('../../src/lib/sms');
    const route = await import('../../src/app/api/webhooks/twilio/[hook]/route');
    const phone = '+61400123456';
    const form = { AccountSid: process.env.TWILIO_ACCOUNT_SID, MessageSid: 'SM' + '2'.repeat(32), From: phone, To: process.env.TWILIO_SMS_FROM, Body: 'STOP' };
    const webhookPath = '/api/webhooks/twilio/incoming';
    const req = (signature: string) => new Request('https://example.test' + webhookPath, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature }, body: new URLSearchParams(form),
    });
    const params = { params: Promise.resolve({ hook: 'incoming' }) };
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, 'https://example.test' + webhookPath, form);
    assert.equal((await route.POST(req('invalid'), params)).status, 403);
    assert.equal(await db.getSmsPreference(phone), null);
    await db.setSmsPreference(phone, 'opted-in', 'Liam');
    assert.equal((await route.POST(req(signature), params)).status, 200);
    assert.equal((await route.POST(req(signature), params)).status, 200);
    assert.equal(await db.getSmsPreference(phone), 'opted-out');
    assert.equal(await db.setSmsPreference(phone, 'opted-in', 'Lincoln'), false);
    assert.equal((await db.listSms(phone)).length, 1);
    await sms.receiveSms({ ...form, Body: 'START', MessageSid: 'SM' + '3'.repeat(32) });
    assert.equal(await db.getSmsPreference(phone), 'opted-in');

    await context.test('inbox read state is independent per profile and cannot move backwards', async () => {
      const otherPhone = '+61400123457';
      const inbound = (id: string, createdAt: string) => db.insertSms({
        id, phone: otherPhone, kind: 'reply', recordId: null, body: id, direction: 'inbound',
        status: 'received', actor: 'customer', createdAt, updatedAt: createdAt,
      });
      await inbound('receipt-1', '2026-11-21T00:00:00.000Z');
      const conversation = async (profile: 'liam' | 'lincoln') =>
        (await sms.listSmsConversations(false, profile)).find(row => row.phone === otherPhone);
      assert.equal((await conversation('liam'))?.unread, true);
      await db.markSmsRead(otherPhone, 'liam', 'receipt-1');
      assert.equal((await conversation('liam'))?.unread, false);
      assert.equal((await conversation('lincoln'))?.unread, true);
      assert.deepEqual((await conversation('lincoln'))?.latestIncomingReceipts, [{ profile: 'liam', source: 'crm' }]);
      await inbound('receipt-2', '2026-11-21T00:01:00.000Z');
      assert.equal((await conversation('liam'))?.unread, true);
      assert.deepEqual((await conversation('lincoln'))?.latestIncomingReceipts, []);
      await db.markChatgptSmsRead(['receipt-2'], 'lincoln');
      assert.equal((await conversation('lincoln'))?.unread, false);
      assert.equal((await conversation('liam'))?.unread, true);
      await db.markSmsRead(otherPhone, 'lincoln', 'receipt-2');
      await db.markSmsRead(otherPhone, 'lincoln', 'receipt-1');
      await db.markSmsRead(phone, 'liam', 'receipt-2');
      assert.equal((await conversation('lincoln'))?.unread, false);
      assert.deepEqual((await conversation('liam'))?.latestIncomingReceipts, [
        { profile: 'lincoln', source: 'crm' }, { profile: 'lincoln', source: 'chatgpt' },
      ]);
      assert.equal((await db.listSmsReadStates(phone))[phone].liam, undefined);
    });

    const id = 'a'.repeat(64);
    const at = new Date().toISOString();
    const fixture = { id, kind: 'booking', recordId: 'test', phone, body: 'Test', direction: 'outbound', status: 'sending', actor: 'Liam', createdAt: at, updatedAt: at } as const;
    assert.equal(await db.insertSms(fixture), true);
    assert.equal(await db.insertSms(fixture), false);
    const status = { AccountSid: form.AccountSid, MessageSid: 'SM' + '4'.repeat(32), From: form.To, To: phone, MessageStatus: 'delivered' };
    await sms.receiveSmsStatus(id, status);
    await sms.receiveSmsStatus(id, { ...status, MessageStatus: 'sent' });
    assert.equal((await db.getSms(id))?.status, 'delivered');
    assert.equal((await sms.dispatchSms(id))?.status, 'delivered');
    await assert.rejects(sms.sendSms({ kind: 'manual', recordId: 'test', text: 'Disabled' }, 'Liam'), /disabled/);

    const booking = await db.addBooking({
      name: 'Test Customer', phone: '0400 123 456', email: '', address: '', suburb: '',
      service: 'window-washing', propertyType: 'residential', preferredDate: '', preferredTime: '',
      notes: '', quoteAmount: null, adminNotes: '',
    });
    const recipients = ['+61411111111', '+61422222222'];
    process.env.TWILIO_SMS_STAFF_ALERT_RECIPIENTS = recipients.join(',');
    // Opted-out fixture numbers exercise queueing and dedup without a Twilio API send.
    for (const recipient of recipients) await db.setSmsPreference(recipient, 'opted-out', 'test');
    process.env.TWILIO_SMS_ENABLED = 'true';
    const reply = { ...form, MessageSid: 'SM' + '5'.repeat(32), Body: 'Can we move the booking?' };
    await sms.receiveSms(reply, true);
    await sms.receiveSms(reply, true);
    assert.equal((await db.listSms(phone)).find(row => row.sid === reply.MessageSid)?.recordId, booking.id);
    assert.deepEqual((await db.listLatestCustomerSms()).filter(row => row.sid).map(row => row.sid), [reply.MessageSid]);
    assert.equal((await sms.resolveSmsTarget({ kind: 'manual', recordId: 'phone:' + phone }, true)).phone, phone);
    await assert.rejects(sms.resolveSmsTarget({ kind: 'manual', recordId: 'phone:+12025550123' }, true), /Australian mobiles/);
    for (const recipient of recipients) {
      const alerts = await db.listSms(recipient);
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].kind, 'staff-alert');
      assert.equal((await db.listSms(recipient, false)).length, 0);
      assert.equal(alerts[0].status, 'canceled');
      assert.ok(alerts[0].body.includes(reply.Body));
      assert.ok(alerts[0].body.includes('https://example.test/admin/bookings/' + booking.id));
    }

    const newPhone = '+61499999999';
    await db.setSmsPreference(newPhone, 'opted-in', 'Liam');
    const submitted: string[] = [];
    const provider = context.mock.method(twilio.RequestClient.prototype, 'request', async (options: { data: { Body: string } }) => {
      submitted.push(options.data.Body);
      return { statusCode: 201, body: { sid: 'SM' + String(submitted.length).padStart(32, '0'), status: 'queued' } };
    });
    try {
      const target = { kind: 'manual', recordId: 'phone:' + newPhone } as const;
      const first = await sms.sendSms({ ...target, text: 'First message', requestId: 'first' }, 'Liam');
      const second = await sms.sendSms({ ...target, text: 'Second message', requestId: 'second' }, 'Liam');
      assert.equal(first?.status, 'pending');
      assert.equal(second?.status, 'pending');
      assert.equal(submitted.length, 1);
      const welcome = (await db.listSms(newPhone)).find(row => row.kind === 'welcome')!;
      const callback = { MessageSid: welcome.sid!, From: form.To, To: newPhone };
      await sms.receiveSmsStatus(welcome.id, { ...callback, MessageStatus: 'sent' });
      assert.equal(submitted.length, 1);
      await sms.receiveSmsStatus(welcome.id, { ...callback, MessageStatus: 'delivered' });
      await sms.receiveSmsStatus(welcome.id, { ...callback, MessageStatus: 'delivered' });
      assert.equal(submitted.length, 3);
      assert.match(submitted[0], /Reply STOP to opt out/);
      assert.match(submitted[1], /First message/);
      assert.match(submitted[2], /Second message/);
    } finally {
      provider.mock.restore();
    }
  } finally {
    process.chdir(cwd);
    try { await rm(scratch, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); }
    catch (error) {
      if (!['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      context.diagnostic('Windows retained a temporary test directory.');
    }
  }
});
