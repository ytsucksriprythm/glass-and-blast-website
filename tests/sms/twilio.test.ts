import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

    await context.test('SMS history puts the welcome notice before the customer message', async () => {
      const recipient = '+61400123459';
      const queuedAt = '2026-11-22T06:46:00.000Z';
      const welcomeAt = '2026-11-22T06:46:01.000Z';
      const sentAt = '2026-11-22T06:46:02.000Z';
      for (const actor of ['Liam', 'mcp:liam']) {
        const request = {
          id: actor + '-message', kind: 'manual', recordId: null, phone: recipient, body: 'Receipt',
          direction: 'outbound', status: 'delivered', actor, createdAt: queuedAt,
          updatedAt: sentAt, sid: actor + '-sid',
        } as const;
        await db.insertSms(request);
      }
      await db.insertSms({
        id: 'welcome', kind: 'welcome', recordId: null, phone: recipient, body: 'Welcome',
        direction: 'outbound', status: 'delivered', actor: 'Liam', createdAt: welcomeAt,
        submittedAt: welcomeAt, updatedAt: sentAt, sid: 'welcome-sid',
      });
      assert.deepEqual((await db.listSms(recipient)).map(row => row.kind), ['manual', 'manual', 'welcome']);
      assert.equal((await db.listSms(recipient, true, 2, 1))[0]?.kind, 'welcome');
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
    await context.test('customer replies only move uncontacted leads to contacted', async () => {
      assert.equal(booking.status, 'uncontacted');
      await sms.receiveSms({ ...form, Body: 'HELP', MessageSid: 'SM' + '6'.repeat(32) });
      assert.equal((await db.getBookingById(booking.id))?.status, 'uncontacted');
      await sms.receiveSms({ ...form, Body: 'Could I get a quote?', MessageSid: 'SM' + '7'.repeat(32) });
      const contacted = await db.getBookingById(booking.id);
      assert.equal(contacted?.status, 'contacted');
      assert.ok(contacted.contactedAt);
      await db.updateBooking(booking.id, { status: 'quoted' });
      await sms.receiveSms({ ...form, Body: 'Thanks for the quote', MessageSid: 'SM' + '8'.repeat(32) });
      assert.equal((await db.getBookingById(booking.id))?.status, 'quoted');
    });

    await context.test('inbox and lead aging use SMS and status activity', async () => {
      const bookingsFile = join(scratch, 'data', 'bookings.json');
      const existing = JSON.parse(readFileSync(bookingsFile, 'utf8'));
      const now = new Date().toISOString();
      const old = new Date(Date.now() - 15 * 86400000).toISOString();
      const fixtures = [
        { id: 'recent-text', phone: '+61410000001', statusChangedAt: old },
        { id: 'recent-status', phone: '+61410000002', statusChangedAt: now },
        { id: 'stale-lead', phone: '+61410000003', statusChangedAt: old },
      ];
      writeFileSync(bookingsFile, JSON.stringify([...existing, ...fixtures.map(fixture => ({
        ...booking, status: 'uncontacted', createdAt: old, updatedAt: now, ...fixture,
      }))]));
      for (const [index, fixture] of fixtures.entries()) {
        const at = index === 0 ? now : old;
        await db.insertSms({
          id: fixture.id, kind: 'manual', recordId: fixture.id, phone: fixture.phone, body: 'Quote follow-up',
          direction: 'outbound', status: 'delivered', actor: 'Liam', sid: fixture.id,
          createdAt: at, submittedAt: at, updatedAt: at,
        });
      }
      const conversation = async (phone: string) => (await sms.listSmsConversations()).find(row => row.phone === phone);
      assert.equal((await conversation(fixtures[0].phone))?.group, 'inactive');
      assert.equal((await conversation(fixtures[1].phone))?.group, 'inactive');
      assert.equal((await conversation(fixtures[2].phone))?.group, 'cold');
      assert.deepEqual((await db.checkStaleLeads()).map(row => row.id), ['stale-lead']);
      assert.equal((await db.getBookingById('stale-lead'))?.status, 'cold');
      assert.equal((await conversation(fixtures[2].phone))?.group, 'cold');
      await sms.receiveSms({ ...form, From: fixtures[0].phone, Body: 'Thanks!', MessageSid: 'SM' + '9'.repeat(32) });
      assert.equal((await conversation(fixtures[0].phone))?.group, 'active');
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
    assert.deepEqual((await db.listLatestCustomerSms(false, phone)).filter(row => row.sid && row.phone === phone).map(row => row.sid), [reply.MessageSid]);
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
    const submitted: string[] = [];
    const provider = context.mock.method(twilio.RequestClient.prototype, 'request', async (options: { data: { Body: string } }) => {
      if (options.data?.Body) submitted.push(options.data.Body);
      return { statusCode: 201, body: { sid: 'SM' + String(submitted.length).padStart(32, '0'), status: 'queued' } };
    });
    try {
      const target = { kind: 'manual', recordId: 'phone:' + newPhone } as const;
      const firstInput = { ...target, text: 'First message', requestId: 'first' };
      const optedOutPhone = recipients[0];
      await assert.rejects(sms.sendSms({
        ...firstInput, recordId: 'phone:' + optedOutPhone,
      }, 'Liam'), /customer must text START/);
      assert.equal(submitted.length, 0);
      const first = await sms.sendSms(firstInput, 'Liam');
      assert.equal(await db.getSmsPreference(newPhone), null);
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

      await context.test('booking reminders skip past due times on enable and re-enable', async testContext => {
        process.env.TWILIO_SMS_AUTOMATION = 'false';
        for (const row of await db.listSms(newPhone)) await db.changeSms(row, { status: 'delivered' });
        const start = Date.now();
        const makeAppointment = (hours: number, address: string, overrides: { phone?: string; status?: 'cancelled' } = {}, dueOffset = 60000) => db.addBooking({
          name: 'Test Customer', phone: newPhone, address, suburb: 'Ainslie', service: 'window-washing',
          email: '', preferredDate: '', preferredTime: '', notes: '',
          propertyType: 'residential', status: 'confirmed', scheduledAt: new Date(start + dueOffset + hours * 3600000).toISOString(), ...overrides,
        });
        await makeAppointment(1, '1 Hour Street');
        await makeAppointment(24, '24 Day Street', {}, 120000);
        await makeAppointment(168, '7 Week Street');
        await makeAppointment(1, '2 Cancelled Street', { status: 'cancelled' });
        await makeAppointment(1, '3 Opted Out Street', { phone: recipients[0] });
        await makeAppointment(1, '4 Already Due Street', {}, -60000);
        await makeAppointment(1, '5 Past Appointment Street', {}, -7200000);
        await makeAppointment(1, '6 Pause Street', {}, 180000);
        process.env.TWILIO_SMS_AUTOMATION = 'true';
        let now = start;
        testContext.mock.method(Date, 'now', () => now);

        assert.equal((await sms.runSmsCron()).bookingRemindersChecked, 0);
        await db.updateSettings({ smsBookingReminderHour: true, smsBookingReminderWeek: true });
        assert.equal((await sms.runSmsCron()).bookingRemindersChecked, 0);
        now += 60000;
        await Promise.all([sms.runSmsCron(), sms.runSmsCron()]);
        const reminders = async () => (await db.listSms(newPhone)).filter(row => row.kind === 'booking-reminder');
        assert.deepEqual((await reminders()).map(row => row.bookingReminderHours!).sort((a, b) => a - b), [1, 168]);
        assert.equal(submitted.filter(body => body.includes('a reminder')).length, 2);
        assert.match(submitted.find(body => body.includes('1 Hour Street')) ?? '', /Window Washing booking on .*\d+:\d\d.*1 Hour Street, Ainslie/);
        await db.updateSettings({ smsBookingReminderDay: true });
        await db.updateSettings({ smsBookingReminderHour: false });
        now += 60000;
        assert.equal((await sms.runSmsCron()).bookingRemindersChecked, 1);
        assert.deepEqual((await reminders()).map(row => row.bookingReminderHours!).sort((a, b) => a - b), [1, 24, 168]);
        now += 120000;
        await db.updateSettings({ smsBookingReminderHour: true });
        assert.equal((await sms.runSmsCron()).bookingRemindersChecked, 0);
        assert.equal(submitted.filter(body => body.includes('a reminder')).length, 3);
      });
      await context.test('LARP messages populate every inbox folder and never reach Twilio', async () => {
        const { buildLarpBookings, buildLarpInvoices, seedLarpFeatureExamples } = await import('../../src/lib/larp');
        const { invoiceDaysOverdue } = await import('../../src/lib/invoice');
        const examples = buildLarpBookings(10_000).slice(0, 4);
        const demoMessages = seedLarpFeatureExamples(examples);
        assert.equal(demoMessages.length, 4);
        for (const example of examples) await db.insertRawBooking(example);
        for (const message of demoMessages) await db.insertSms(message);
        const conversations = await sms.listSmsConversations();
        assert.deepEqual(examples.slice(0, 3).map(example => conversations.find(row => row.phone === example.phone)?.group),
          ['active', 'inactive', 'cold']);
        assert.ok(buildLarpInvoices(examples).some(invoice => invoiceDaysOverdue(invoice) >= 30));
        assert.ok((await db.checkStaleLeads()).some(job => job.id === examples[2].id));
        await db.updateSettings({ larpModeActive: true });
        const sentBefore = submitted.length;
        const result = await sms.sendSms({ kind: 'manual', recordId: examples[0].id, text: 'Demo reply' }, 'Liam');
        assert.ok(result?.id.startsWith('LARP-'));
        assert.equal(submitted.length, sentBefore);
        assert.equal(await db.deleteLarpSms(), 5);
        assert.equal((await db.listSms(examples[0].phone)).length, 0);
      });
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
