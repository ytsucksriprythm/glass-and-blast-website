// Authentication & access-control tests for the ChatGPT MCP connector.
// Run: npm run test:mcp

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupDb, seed, configureEnv, req, registerClient, authorizeUrl, getTx, fullLogin, rpc, callTool, ownerExec,
  OWNER_PASSWORD, RESOURCE, REDIRECT, BASE,
} from './harness';
import * as oauth from '../../src/lib/mcp/oauth';
import { handleMcp } from '../../src/lib/mcp/handler';
import { signJwt, pkceS256, randomToken } from '../../src/lib/mcp/crypto';

before(async () => {
  configureEnv();
  await setupDb();
  await seed();
});

const secret = () => process.env.MCP_TOKEN_SECRET!;
const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  iss: BASE, aud: RESOURCE, sub: 'owner', client_id: 'x', scope: 'business.read', iat: now(), exp: now() + 600, jti: 'j', ver: '1', ...over,
});

test('metadata advertises OAuth 2.1 + PKCE S256 + resource binding', async () => {
  const prm = await oauth.protectedResourceMetadata().json();
  assert.equal(prm.resource, RESOURCE);
  assert.deepEqual(prm.authorization_servers, [BASE]);
  const as = await oauth.authorizationServerMetadata().json();
  assert.equal(as.issuer, BASE);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.ok(as.registration_endpoint.endsWith('/api/oauth/register'));
  assert.equal(as.authorization_response_iss_parameter_supported, true);
  assert.ok(!as.grant_types_supported.includes('implicit') && !as.grant_types_supported.includes('password'));
});

test('unauthenticated MCP requests get 401 + WWW-Authenticate pointing at resource metadata, and no data', async () => {
  const res = await rpc(null, 'tools/call', { name: 'search_bookings', arguments: { query: 'jane' } });
  assert.equal(res.status, 401);
  const www = res.headers.get('www-authenticate')!;
  assert.match(www, /^Bearer resource_metadata="http:\/\/localhost:3000\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  const body = await res.text();
  assert.ok(!body.includes('Jane'), 'no customer data in 401 body');
});

test('forged, wrong-audience, expired, revoked-version, wrong-issuer and wrong-scope tokens are all rejected', async () => {
  const cases: [string, string, number][] = [
    ['garbage', 'not-a-jwt', 401],
    ['wrong key', signJwt(claims(), 'a-completely-different-secret-value-xxxxxxxxxx'), 401],
    ['wrong audience', signJwt(claims({ aud: 'https://evil.example/api/mcp' }), secret()), 401],
    ['expired', signJwt(claims({ exp: now() - 5 }), secret()), 401],
    ['revoked version', signJwt(claims({ ver: '0' }), secret()), 401],
    ['wrong issuer', signJwt(claims({ iss: 'https://evil.example' }), secret()), 401],
    ['other subject', signJwt(claims({ sub: 'someone-else' }), secret()), 401],
    ['wrong scope', signJwt(claims({ scope: 'other' }), secret()), 403],
  ];
  for (const [label, tok, status] of cases) {
    const res = await rpc(tok, 'tools/call', { name: 'search_bookings', arguments: { query: 'jane' } });
    assert.equal(res.status, status, label);
    assert.ok(!(await res.text()).includes('Jane'), `${label}: no data leaked`);
  }
  // alg confusion: header claims "none"
  const [, body] = signJwt(claims(), secret()).split('.');
  const noneTok = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${body}.`;
  assert.equal((await rpc(noneTok, 'tools/list')).status, 401);
});

test('valid token works; browser requests from other origins are refused', async () => {
  const { accessToken } = await fullLogin();
  assert.equal((await rpc(accessToken, 'tools/list')).status, 200);
  const evil = await rpc(accessToken, 'tools/list', {}, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  const chatgpt = await rpc(accessToken, 'tools/list', {}, { origin: 'https://chatgpt.com' });
  assert.equal(chatgpt.status, 200);
});

test('client registration only accepts ChatGPT redirect URIs', async () => {
  const bad = await oauth.register(req('/api/oauth/register', { method: 'POST', jsonBody: { redirect_uris: ['https://evil.example/cb'] } }));
  assert.equal(bad.status, 400);
  const lookalike = await oauth.register(req('/api/oauth/register', { method: 'POST', jsonBody: { redirect_uris: ['https://chatgpt.com.evil.example/connector/oauth/x'] } }));
  assert.equal(lookalike.status, 400);
  assert.ok(await registerClient('https://chatgpt.com/connector/oauth/abc123'));
});

test('authorize: unknown client / unregistered redirect show an error page instead of redirecting', async () => {
  const unknown = await oauth.authorizeGet(req(authorizeUrl('nope', 'x'.repeat(43))));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.get('location'), null);
  const clientId = await registerClient();
  const wrongRedirect = await oauth.authorizeGet(req(authorizeUrl(clientId, 'x'.repeat(43), { redirect_uri: 'https://chatgpt.com/connector/oauth/other' })));
  assert.equal(wrongRedirect.status, 400);
  // Valid page is framed-protected
  const ok = await oauth.authorizeGet(req(authorizeUrl(clientId, 'x'.repeat(43))));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('x-frame-options'), 'DENY');
  assert.match(ok.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
  assert.match(ok.headers.get('content-security-policy')!, /form-action 'self' https:\/\/chatgpt\.com/);
  // PKCE plain / missing → error redirected to the (verified) client
  const plainPkce = await oauth.authorizeGet(req(authorizeUrl(clientId, 'x'.repeat(43), { code_challenge_method: 'plain' })));
  assert.equal(plainPkce.status, 302);
  assert.match(plainPkce.headers.get('location')!, /error=invalid_request/);
  const wrongResource = await oauth.authorizeGet(req(authorizeUrl(clientId, 'x'.repeat(43), { resource: 'https://evil.example/api/mcp' })));
  assert.match(wrongResource.headers.get('location')!, /error=invalid_target/);
});

test('wrong password is rejected, and repeated failures lock out sign-in', async () => {
  const clientId = await registerClient();
  const tx = await getTx(clientId, pkceS256(randomToken(48)));
  const ip = { 'x-forwarded-for': '192.0.2.77' };
  for (let i = 0; i < 5; i++) {
    const res = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx, password: 'wrong', decision: 'approve' }, headers: ip }));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Incorrect password/);
  }
  const locked = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx, password: OWNER_PASSWORD, decision: 'approve' }, headers: ip }));
  assert.match(await locked.text(), /Too many failed attempts/);
  assert.equal(locked.headers.get('location'), null, 'no code issued while locked');
  // tampered form state
  const tampered = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx: tx.slice(0, -2) + 'AA', password: OWNER_PASSWORD, decision: 'approve' } }));
  assert.match(await tampered.text(), /expired/);
  // deny
  const tx2 = await getTx(clientId, pkceS256(randomToken(48)));
  const denied = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx: tx2, decision: 'deny' }, headers: { 'x-forwarded-for': '192.0.2.78' } }));
  assert.match(denied.headers.get('location')!, /error=access_denied/);
});

test('token endpoint: PKCE verified, codes single-use, redirect/resource must match', async () => {
  const clientId = await registerClient();
  const verifier = randomToken(48);
  const tx = await getTx(clientId, pkceS256(verifier));
  const res = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx, password: OWNER_PASSWORD, decision: 'approve' }, headers: { 'x-forwarded-for': '198.51.100.20' } }));
  const loc = new URL(res.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, REDIRECT);
  assert.equal(loc.searchParams.get('state'), 'st-1');
  assert.equal(loc.searchParams.get('iss'), BASE);
  const code = loc.searchParams.get('code')!;
  const tokenReq = (form: Record<string, string>) => oauth.token(req('/api/oauth/token', { method: 'POST', form: { grant_type: 'authorization_code', client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE, ...form } }));

  const badVerifier = await tokenReq({ code, code_verifier: randomToken(48) });
  assert.equal(badVerifier.status, 400);
  // The failed attempt consumed the code (single-use), so even the right verifier now fails.
  const reuse = await tokenReq({ code, code_verifier: verifier });
  assert.equal(reuse.status, 400);

  // Fresh code, wrong resource
  const tx2 = await getTx(clientId, pkceS256(verifier));
  const code2 = new URL((await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx: tx2, password: OWNER_PASSWORD, decision: 'approve' }, headers: { 'x-forwarded-for': '198.51.100.21' } }))).headers.get('location')!).searchParams.get('code')!;
  const wrongRes = await tokenReq({ code: code2, code_verifier: verifier, resource: 'https://evil.example/api/mcp' });
  assert.equal(wrongRes.status, 400);
  assert.equal((await wrongRes.json()).error, 'invalid_target');
  const good = await tokenReq({ code: code2, code_verifier: verifier });
  assert.equal(good.status, 200);
  const j = await good.json();
  assert.equal(j.token_type, 'Bearer');
  assert.equal(good.headers.get('cache-control'), 'no-store');
  const payload = JSON.parse(Buffer.from(j.access_token.split('.')[1], 'base64url').toString());
  assert.equal(payload.aud, RESOURCE);
  assert.equal(payload.scope, 'business.read');
});

test('refresh tokens rotate; replaying an old one revokes the whole family', async () => {
  const { refreshToken, clientId } = await fullLogin();
  const refresh = (rt: string) => oauth.token(req('/api/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: rt, client_id: clientId } }));
  const r1 = await refresh(refreshToken);
  assert.equal(r1.status, 200);
  const rt2 = (await r1.json()).refresh_token;
  assert.notEqual(rt2, refreshToken);
  const replay = await refresh(refreshToken);
  assert.equal(replay.status, 400, 'old refresh token rejected');
  const afterReplay = await refresh(rt2);
  assert.equal(afterReplay.status, 400, 'family revoked after reuse detected');
  // another client can't use someone else's refresh token
  const other = await fullLogin();
  const otherClient = await registerClient();
  const stolen = await oauth.token(req('/api/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: other.refreshToken, client_id: otherClient } }));
  assert.equal(stolen.status, 400);
});

test('revocation endpoint kills a refresh token', async () => {
  const { refreshToken, clientId } = await fullLogin();
  const rev = await oauth.revoke(req('/api/oauth/revoke', { method: 'POST', form: { token: refreshToken, client_id: clientId } }));
  assert.equal(rev.status, 200);
  const after = await oauth.token(req('/api/oauth/token', { method: 'POST', form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId } }));
  assert.equal(after.status, 400);
});

test('bumping MCP_TOKEN_VERSION revokes every existing access token', async () => {
  const { accessToken } = await fullLogin();
  configureEnv({ MCP_TOKEN_VERSION: '2' });
  try {
    assert.equal((await rpc(accessToken, 'tools/list')).status, 401);
  } finally {
    configureEnv();
  }
});

test('kill switch: MCP_ENABLED off → every endpoint is 503 and returns nothing', async () => {
  const { accessToken } = await fullLogin();
  configureEnv({ MCP_ENABLED: 'false' });
  try {
    assert.equal((await rpc(accessToken, 'tools/list')).status, 503);
    assert.equal(oauth.protectedResourceMetadata().status, 503);
    assert.equal((await oauth.authorizeGet(req('/api/oauth/authorize'))).status, 503);
  } finally {
    configureEnv();
  }
  // weak config also fails closed
  configureEnv({ MCP_TOKEN_SECRET: 'short' });
  try { assert.equal((await rpc(accessToken, 'tools/list')).status, 503); } finally { configureEnv(); }
});

test('oversized MCP requests are rejected', async () => {
  const { accessToken } = await fullLogin();
  const res = await handleMcp(req('/api/mcp', { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: 'x'.repeat(70 * 1024) }));
  assert.equal(res.status, 413);
});

test('audit trail records tool calls and auth events without secrets or search text', async () => {
  const { accessToken } = await fullLogin();
  await callTool(accessToken, 'search_bookings', { query: 'Gate code 4321' });
  const rows = await ownerExec(`SELECT * FROM mcp_audit_log ORDER BY id`);
  const events = new Set(rows.map(r => r.event));
  for (const e of ['client_registered', 'login_ok', 'login_fail', 'token_issued', 'token_refreshed', 'tool_call', 'auth_fail']) assert.ok(events.has(e), `audit has ${e}`);
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(accessToken), 'no access token in audit');
  assert.ok(!dump.includes(OWNER_PASSWORD), 'no password in audit');
  assert.ok(!dump.includes('Gate code'), 'search text hashed, not stored');
  for (const t of await ownerExec(`SELECT token_hash FROM mcp_oauth_refresh_tokens`)) assert.match(String(t.token_hash), /^[0-9a-f]{64}$/);
});

test('per-client rate limit', async () => {
  const { accessToken } = await fullLogin();
  configureEnv({ MCP_RATE_LIMIT_PER_10MIN: '10' });
  try {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const r = await callTool(accessToken, 'describe_data_coverage');
      if (r.isError && /Rate limit/.test(r.text)) { limited = true; break; }
    }
    assert.ok(limited);
  } finally {
    configureEnv();
  }
});
