import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { smsEstimate } from '../../src/lib/dataFlowsSms';

test('SMS segments account for GSM extension characters and surrogate pairs', () => {
  assert.deepEqual(smsEstimate('^'.repeat(80)), { unicode: false, segments: 1 });
  assert.deepEqual(smsEstimate('^'.repeat(154)), { unicode: false, segments: 3 });
  assert.deepEqual(smsEstimate('🙂'.repeat(35)), { unicode: true, segments: 1 });
  assert.deepEqual(smsEstimate('🙂'.repeat(67)), { unicode: true, segments: 3 });
});

test('DataFlows outbox pins routes, reconciles delivery, and shares consent and inbox with Twilio', async context => {
  const cwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'gb-dataflows-')));
  for (const key of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING']) delete process.env[key];
  Object.assign(process.env, {
    TWILIO_SMS_ENABLED: 'true', TWILIO_SMS_AUTOMATION: 'false',
    TWILIO_SMS_FROM: '+61491570001', TWILIO_ACCOUNT_SID: 'fixture', TWILIO_AUTH_TOKEN: 'fixture',
    TWILIO_SMS_PUBLIC_URL: 'https://example.test', DATAFLOWS_SENDER_NUMBER: '+61491570002',
    DATAFLOWS_API_TOKEN: 'fixture', DATAFLOWS_WEBHOOK_SECRET: 'x'.repeat(32), DATAFLOWS_CUTOVER_READY: 'true',
  });
  const sends: string[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://sms.dataflows.com.au/api/http/sms/send');
    const data = JSON.parse(String(init.body));
    assert.equal(data.sender_id, '61491570002');
    sends.push(data.recipient);
    return Response.json({ status: 'success', data: { uid: 'test-' + sends.length } });
  });
  try {
    const db = await import('../../src/lib/db');
    const sms = await import('../../src/lib/sms');
    const { smsMigrationReport } = await import('../../src/lib/smsMigration');
    const legacy = '+61491570011';
    const fresh = '+61491570012';
    await sms.receiveSms({ From: legacy, To: process.env.TWILIO_SMS_FROM!, Body: 'Existing reply', MessageSid: 'SM' + '1'.repeat(32) });
    assert.equal((await smsMigrationReport()).legacyTwilio, 1);
    await db.updateSettings({ smsDataFlowsNewConversations: true });
    const target = { kind: 'manual' as const, recordId: 'phone:' + fresh, text: 'Hello', requestId: 'fixture' };
    await Promise.all([sms.sendSms(target, 'test'), sms.sendSms(target, 'test')]);
    assert.deepEqual(sends, ['61491570012']);
    assert.equal(await sms.receiveDataFlowsStatus('test-1', 'delivered'), true);
    assert.deepEqual(sends, ['61491570012', '61491570012']);
    await db.updateSettings({ smsDataFlowsNewConversations: false });
    await sms.sendSms({ ...target, requestId: 'second' }, 'test');
    assert.equal(sends.length, 3);
    const event = { uid: 'in-1', from: legacy, to: process.env.DATAFLOWS_SENDER_NUMBER!, body: 'STOP', timestamp: new Date().toISOString() };
    await sms.receiveDataFlowsSms(event);
    await sms.receiveDataFlowsSms(event);
    assert.equal((await db.listSms(legacy)).length, 2);
    assert.equal(await db.getSmsPreference(legacy), 'opted-out');
    const { routes } = await db.smsRoutingSnapshot();
    assert.equal(routes.find(route => route.phone === legacy)?.provider, 'twilio');
    assert.equal(routes.find(route => route.phone === legacy)?.migrationStatus, 'review');
    assert.equal(routes.find(route => route.phone === fresh)?.provider, 'dataflows');
  } finally {
    process.chdir(cwd);
  }
});
