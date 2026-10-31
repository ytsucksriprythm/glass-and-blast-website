// Vapi ("Atlas" phone assistant) machine login: OAuth client-credentials grant
// with narrow scopes. Checks the grant itself, that tokens only see their
// scoped tools, that config changes revoke tokens immediately, and that the
// owner (ChatGPT / Claude) flow is unchanged.
// Run: npm run test:mcp

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

// Quote writes go through src/lib/db.ts → local JSON files under cwd/data, so
// run from a throwaway folder (same as writes.test.ts).
const repoCwd = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-vapi-'));
process.chdir(tmp);

/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-explicit-any */
let h: typeof import('./harness');
let oauth: typeof import('../../src/lib/mcp/oauth');
let bookingId = '';

const CLIENT_ID = 'gbvapi_testclient123';
const SECRET = 'test-vapi-secret-abcdefghijklmnopqrstuvwxyz012345';
const HASH = `sha256:${createHash('sha256').update(SECRET).digest('hex')}`;
const VAPI_ENV = { MCP_WRITES_ENABLED: 'true', MCP_VAPI_CLIENT_ID: CLIENT_ID, MCP_VAPI_CLIENT_SECRET_HASH: HASH, MCP_VAPI_SCOPES: undefined };

before(async () => {
  h = await import('./harness');
  oauth = await import('../../src/lib/mcp/oauth');
  h.configureEnv(VAPI_ENV);
  await h.setupDb();
  await h.seed();
  const db = await import('../../src/lib/db');
  bookingId = (await db.addBooking({ name: 'Atlas Caller', email: '', phone: '0400 222 333', service: 'window-washing', propertyType: 'residential', address: '5 Phone St', suburb: 'Ainslie', preferredDate: '', preferredTime: '', notes: '' } as any)).id;
});
after(() => {
  process.chdir(repoCwd);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const tokenReq = (form: Record<string, string>, headers: Record<string, string> = {}) =>
  oauth.token(h.req('/api/oauth/token', { method: 'POST', form: { grant_type: 'client_credentials', ...form }, headers }));

async function machineToken(form: Record<string, string> = {}) {
  const res = await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET, ...form });
  return { res, body: await res.json() as Record<string, any> };
}

async function toolNames(token: string) {
  return ((await (await h.rpc(token, 'tools/list')).json()).result.tools as any[]).map(t => t.name).sort();
}

const ATLAS_TOOLS = ['create_quote', 'get_booking', 'get_customer_history', 'get_quote', 'list_quotes', 'list_schedule', 'search_bookings', 'update_quote'];

test('client credentials: post body and Basic auth both work; 1-hour token, no refresh token', async () => {
  const { res, body } = await machineToken();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, 'bookings.read quotes.read quotes.write');
  assert.equal(body.refresh_token, undefined);
  assert.equal(res.headers.get('cache-control'), 'no-store');

  const basic = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  const viaBasic = await tokenReq({}, { authorization: `Basic ${basic}` });
  assert.equal(viaBasic.status, 200);

  const meta = await oauth.authorizationServerMetadata().json();
  assert.ok(meta.grant_types_supported.includes('client_credentials'));
});

test('wrong secret / wrong id / disallowed scope are refused; requesting a narrower scope works', async () => {
  assert.equal((await tokenReq({ client_id: CLIENT_ID, client_secret: 'wrong' })).status, 401);
  assert.equal((await tokenReq({ client_id: 'gbvapi_someoneelse', client_secret: SECRET })).status, 401);
  assert.equal((await tokenReq({ client_id: CLIENT_ID })).status, 401, 'no secret');
  const owner = await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET, scope: 'business.read' });
  assert.equal(owner.status, 400);
  assert.equal((await owner.json()).error, 'invalid_scope', 'cannot get the owner scope');
  const narrow = await machineToken({ scope: 'bookings.read' });
  assert.equal(narrow.body.scope, 'bookings.read');
  assert.deepEqual(await toolNames(narrow.body.access_token), ['get_booking', 'get_customer_history', 'list_schedule', 'search_bookings']);
});

test('Vapi token sees only bookings / quotes tools — no invoices, payments, settings, reports or booking writes', async () => {
  const { body } = await machineToken();
  assert.deepEqual(await toolNames(body.access_token), ATLAS_TOOLS);
  const init = await (await h.rpc(body.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vapi', version: '1' } })).json();
  assert.match(init.result.instructions, /Never read out another customer's/);
  const blocked = await h.callTool(body.access_token, 'get_invoice', { idOrNumber: 'GB1044' }).catch(e => e);
  assert.ok(blocked instanceof Error || blocked.isError, 'get_invoice is not callable');
});

test('Vapi token can read bookings and quotes, and create + update a quote', async () => {
  const { body } = await machineToken();
  const t = body.access_token;
  const found = await h.callTool(t, 'search_bookings', { query: 'Jane' });
  assert.equal(found.isError, false, found.text);
  assert.ok(found.data.total >= 1);
  const q = await h.callTool(t, 'get_quote', { idOrNumber: 'Q1000' });
  assert.equal(q.isError, false, q.text);
  const created = await h.callTool(t, 'create_quote', { bookingId, items: [{ key: 'window-washing-outside', amount: 250 }] });
  assert.equal(created.isError, false, created.text);
  assert.equal(created.data.quote.amount, 250);
  const upd = await h.callTool(t, 'update_quote', { idOrNumber: created.data.quote.number, notes: 'From Atlas' });
  assert.equal(upd.isError, false, upd.text);
  assert.equal(upd.data.quote.notes, 'From Atlas');
});

test('quote writes work for Vapi even when owner write tools are off', async () => {
  h.configureEnv({ ...VAPI_ENV, MCP_WRITES_ENABLED: 'false' });
  try {
    const { body } = await machineToken();
    assert.deepEqual(await toolNames(body.access_token), ATLAS_TOOLS);
  } finally { h.configureEnv(VAPI_ENV); }
});

test('removing or narrowing the Vapi config revokes already-issued tokens immediately', async () => {
  const { body } = await machineToken();
  h.configureEnv({ ...VAPI_ENV, MCP_VAPI_SCOPES: 'bookings.read quotes.read' });
  try {
    assert.equal((await h.rpc(body.access_token, 'tools/list')).status, 401, 'token holds quotes.write, no longer allowed');
    assert.equal((await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET, scope: 'quotes.write' })).status, 400);
  } finally { h.configureEnv(VAPI_ENV); }
  h.configureEnv({ ...VAPI_ENV, MCP_VAPI_CLIENT_ID: undefined, MCP_VAPI_CLIENT_SECRET_HASH: undefined });
  try {
    assert.equal((await h.rpc(body.access_token, 'tools/list')).status, 401);
    const off = await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET });
    assert.equal(off.status, 400);
    assert.equal((await off.json()).error, 'unauthorized_client');
    const meta = await oauth.authorizationServerMetadata().json();
    assert.ok(!meta.grant_types_supported.includes('client_credentials'));
  } finally { h.configureEnv(VAPI_ENV); }
  // Bad hash format disables only Vapi, never the owner connector.
  h.configureEnv({ ...VAPI_ENV, MCP_VAPI_CLIENT_SECRET_HASH: 'nope' });
  try {
    assert.equal((await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET })).status, 400);
    assert.equal(oauth.protectedResourceMetadata().status, 200);
  } finally { h.configureEnv(VAPI_ENV); }
});

test('the client-credentials secret can only be guessed 10 times per IP per 15 minutes', async () => {
  const ip = { 'x-forwarded-for': '203.0.113.99' };
  for (let i = 0; i < 10; i++) assert.equal((await tokenReq({ client_id: CLIENT_ID, client_secret: `bad${i}` }, ip)).status, 401);
  assert.equal((await tokenReq({ client_id: CLIENT_ID, client_secret: SECRET }, ip)).status, 429, 'locked even with the right secret');
});

test('owner (ChatGPT / Claude) tokens are unchanged: all read tools plus write tools', async () => {
  const { accessToken } = await h.fullLogin();
  const names = await toolNames(accessToken);
  for (const n of ['get_invoice', 'list_payments', 'get_business_settings', 'create_booking', 'create_invoice', 'create_quote', 'describe_data_coverage']) {
    assert.ok(names.includes(n), n);
  }
  // A Vapi client id can't be used for the owner flows.
  const res = await oauth.token(h.req('/api/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: 'x', client_id: CLIENT_ID, client_secret: SECRET } }));
  assert.equal(res.status, 401);
});
