// OAuth 2.1 authorization server + protected-resource metadata for the
// ChatGPT MCP connector, per the MCP authorization spec and OpenAI's Apps SDK
// auth requirements:
//   - RFC 9728 protected resource metadata, RFC 8414 AS metadata
//   - RFC 7591 dynamic client registration (redirect URIs restricted to ChatGPT)
//   - authorization code + PKCE (S256 only), RFC 8707 resource indicators
//   - RFC 9207 `iss` on the authorization response
//   - rotating refresh tokens with reuse detection, RFC 7009 revocation
//
// There's exactly one authorized account: the business owner, who signs in on
// the authorize page with the MCP owner password (MCP_OWNER_PASSWORD_HASH).
// All handlers return plain Web `Response`s so they're callable from Next.js
// route handlers and directly from tests.

import {
  type McpConfig, getMcpConfig, isAllowedRedirectUri, protectedResourceMetadataUrl,
  MCP_SCOPE, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, AUTH_CODE_TTL_SECONDS, AUTHORIZE_FORM_TTL_SECONDS,
} from './config';
import {
  signJwt, signBlob, verifyBlob, verifyOwnerPassword, randomToken, pkceS256, sha256Hex,
} from './crypto';
import {
  saveClient, getClient, saveCode, consumeCode, saveRefreshToken, rotateRefreshToken,
  revokeRefreshTokenByValue, audit, countEvents, purgeExpired,
} from './authStore';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...NO_STORE, ...headers },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export function notConfigured(): Response {
  return json({ error: 'temporarily_unavailable', error_description: 'This connector is not enabled.' }, 503);
}

export function clientIp(req: Request): string {
  const h = req.headers;
  const fwd = h.get('x-vercel-forwarded-for') || h.get('x-forwarded-for') || h.get('x-real-ip') || '';
  return fwd.split(',')[0].trim().slice(0, 64) || 'unknown';
}

// ─── Metadata ───────────────────────────────────────────────────────────────

const PUBLIC_CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' };

export function protectedResourceMetadata(): Response {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  return new Response(JSON.stringify({
    resource: cfg.resource,
    authorization_servers: [cfg.baseUrl],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Glass & Blast business data (read-only)',
  }), { headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS } });
}

export function authorizationServerMetadata(): Response {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  return new Response(JSON.stringify({
    issuer: cfg.baseUrl,
    authorization_endpoint: `${cfg.baseUrl}/api/oauth/authorize`,
    token_endpoint: `${cfg.baseUrl}/api/oauth/token`,
    registration_endpoint: `${cfg.baseUrl}/api/oauth/register`,
    revocation_endpoint: `${cfg.baseUrl}/api/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [MCP_SCOPE],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false,
  }), { headers: { 'Content-Type': 'application/json', ...PUBLIC_CORS } });
}

// ─── Dynamic client registration ────────────────────────────────────────────

export async function register(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  const ip = clientIp(req);
  // Registration is unauthenticated by design (RFC 7591), so cap it.
  if (await countEvents('client_registered', 3600) >= 30) {
    await audit({ event: 'client_register_rejected', ok: false, ip, detail: { reason: 'rate_limited' } });
    return oauthError('temporarily_unavailable', 'Too many registrations, try again later.', 429);
  }
  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); } catch { return oauthError('invalid_client_metadata', 'Body must be JSON.'); }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!redirectUris.length) return oauthError('invalid_redirect_uri', 'redirect_uris is required.');
  const bad = redirectUris.filter(u => !isAllowedRedirectUri(u, cfg));
  if (bad.length) {
    await audit({ event: 'client_register_rejected', ok: false, ip, detail: { reason: 'redirect_uri_not_allowed', count: bad.length } });
    return oauthError('invalid_redirect_uri', 'Only ChatGPT connector redirect URIs are allowed.');
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  if (grantTypes.some(g => g !== 'authorization_code' && g !== 'refresh_token')) {
    return oauthError('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  }
  const method = (body.token_endpoint_auth_method as string | undefined) ?? 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(method)) {
    return oauthError('invalid_client_metadata', 'Unsupported token_endpoint_auth_method.');
  }
  const clientId = `gbmcp_${randomToken(18)}`;
  const clientSecret = method === 'none' ? null : randomToken(32);
  const clientName = typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : '';
  await saveClient({
    clientId, clientSecretHash: clientSecret ? sha256Hex(clientSecret) : null, clientName,
    redirectUris, tokenEndpointAuthMethod: method as 'none' | 'client_secret_post' | 'client_secret_basic',
  });
  await audit({ event: 'client_registered', ok: true, ip, clientId, detail: { clientName, method } });
  return json({
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    scope: MCP_SCOPE,
  }, 201);
}

// ─── Authorization endpoint (owner sign-in + consent) ──────────────────────

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}

type ParamResult = { ok: true; params: AuthorizeParams; clientName: string } | { ok: false; response: Response };

// Problems with client_id / redirect_uri are shown on-page (never redirected:
// redirecting to an unverified URI is an open redirect). Everything after that
// is reported back to the (verified) redirect URI per OAuth.
async function validateAuthorizeParams(cfg: McpConfig, p: URLSearchParams): Promise<ParamResult> {
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return { ok: false, response: errorPage('Unknown client', 'This connection request came from an unregistered client.') };
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !isAllowedRedirectUri(redirectUri, cfg)) {
    return { ok: false, response: errorPage('Invalid redirect', 'The redirect address in this request is not allowed.') };
  }
  const state = p.get('state') ?? '';
  const back = (error: string, desc: string) => ({ ok: false as const, response: redirectWith(redirectUri, { error, error_description: desc, state }, cfg) });
  if (p.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  const codeChallenge = p.get('code_challenge') ?? '';
  if (p.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const requestedScope = (p.get('scope') ?? MCP_SCOPE).split(/\s+/).filter(Boolean);
  if (requestedScope.some(s => s !== MCP_SCOPE)) return back('invalid_scope', `Only the ${MCP_SCOPE} scope is available.`);
  const resource = p.get('resource') ?? cfg.resource;
  if (resource !== cfg.resource) return back('invalid_target', 'The resource parameter does not match this MCP server.');
  return { ok: true, clientName: client.clientName, params: { clientId, redirectUri, state, codeChallenge, scope: MCP_SCOPE, resource } };
}

function redirectWith(uri: string, params: Record<string, string>, cfg: McpConfig): Response {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('iss', cfg.baseUrl);
  return new Response(null, { status: 302, headers: { Location: u.toString(), ...NO_STORE } });
}

// form-action must also allow the redirect target: browsers apply it to the
// redirect that follows the form POST (back to chatgpt.com).
function pageHeaders(): Record<string, string> {
  const cfg = getMcpConfig();
  const origins = new Set(['https://chatgpt.com']);
  for (const u of cfg?.extraRedirectUris ?? []) { try { origins.add(new URL(u).origin); } catch { /* skip */ } }
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${[...origins].join(' ')}; frame-ancestors 'none'; base-uri 'none'`,
    'Referrer-Policy': 'no-referrer',
    ...NO_STORE,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function shell(title: string, inner: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
body{margin:0;background:#060D1A;color:#e2e8f0;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{max-width:420px;width:100%;background:#0f1b2e;border:1px solid #1e2d45;border-radius:16px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{color:#94a3b8;margin:0 0 16px}ul{color:#cbd5e1;padding-left:20px;margin:0 0 20px}
label{display:block;font-size:14px;margin-bottom:6px}
input[type=password]{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #334155;background:#060D1A;color:#fff;font-size:16px}
.row{display:flex;gap:10px;margin-top:18px}button{flex:1;padding:12px;border-radius:10px;border:0;font-weight:600;font-size:15px;cursor:pointer}
.ok{background:#0ea5e9;color:#fff}.no{background:#1e293b;color:#cbd5e1}.err{color:#fca5a5;margin-bottom:12px}
code{color:#7dd3fc}</style></head><body><main>${inner}</main></body></html>`, { status, headers: pageHeaders() });
}

function errorPage(title: string, message: string): Response {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`, 400);
}

function consentPage(cfg: McpConfig, tx: string, clientName: string, redirectUri: string, error?: string): Response {
  const host = new URL(redirectUri).host;
  return shell('Connect to Glass & Blast', `
<h1>Allow ${esc(clientName || 'this app')} to read your business data?</h1>
<p>Request from <code>${esc(host)}</code>. If you didn't just start connecting from ChatGPT, press Deny.</p>
<ul><li>Read-only access to all customers, leads, bookings, quotes, invoices, payments, recurring plans, notes, photos, activity history, settings and reports.</li>
<li>It cannot create, change or delete anything.</li><li>You can disconnect any time from ChatGPT, or revoke everything server-side.</li></ul>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="${esc(cfg.baseUrl)}/api/oauth/authorize" autocomplete="off">
<input type="hidden" name="tx" value="${esc(tx)}">
<label for="pw">Connector owner password</label>
<input id="pw" type="password" name="password" autocomplete="current-password" required autofocus>
<div class="row"><button class="no" type="submit" name="decision" value="deny" formnovalidate>Deny</button>
<button class="ok" type="submit" name="decision" value="approve">Allow read-only access</button></div>
</form>`);
}

export async function authorizeGet(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  const v = await validateAuthorizeParams(cfg, new URL(req.url).searchParams);
  if (!v.ok) return v.response;
  const tx = signBlob('authorize-form', { ...v.params, exp: Math.floor(Date.now() / 1000) + AUTHORIZE_FORM_TTL_SECONDS }, cfg.tokenSecret);
  return consentPage(cfg, tx, v.clientName, v.params.redirectUri);
}

const LOGIN_FAILS_PER_IP_15MIN = 5;
const LOGIN_FAILS_GLOBAL_1H = 20;

export async function authorizePost(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  // Same-origin form only (the CSP form-action also enforces this in browsers).
  const origin = req.headers.get('origin');
  if (origin && origin !== cfg.baseUrl) return errorPage('Request blocked', 'This form must be submitted from the sign-in page.');

  const form = await req.formData().catch(() => null);
  const txRaw = String(form?.get('tx') ?? '');
  const tx = verifyBlob<AuthorizeParams & { exp: number }>('authorize-form', txRaw, cfg.tokenSecret);
  if (!tx || tx.exp < Date.now() / 1000) return errorPage('Sign-in expired', 'This sign-in page has expired. Start connecting again from ChatGPT.');
  // Re-check the client: it may have been revoked since the page was shown.
  const client = await getClient(tx.clientId);
  if (!client || !client.redirectUris.includes(tx.redirectUri)) return errorPage('Unknown client', 'This connection request is no longer valid.');

  const ip = clientIp(req);
  if (form?.get('decision') !== 'approve') {
    await audit({ event: 'authorize_denied', ok: true, ip, clientId: tx.clientId });
    return redirectWith(tx.redirectUri, { error: 'access_denied', error_description: 'The owner denied access.', state: tx.state }, cfg);
  }

  const [ipFails, globalFails] = await Promise.all([
    countEvents('login_fail', 15 * 60, { ip }),
    countEvents('login_fail', 60 * 60),
  ]);
  if (ipFails >= LOGIN_FAILS_PER_IP_15MIN || globalFails >= LOGIN_FAILS_GLOBAL_1H) {
    await audit({ event: 'login_locked', ok: false, ip, clientId: tx.clientId });
    return consentPage(cfg, txRaw, client.clientName, tx.redirectUri, 'Too many failed attempts. Wait 15–60 minutes and try again.');
  }

  const password = String(form?.get('password') ?? '');
  if (!password || password.length > 512 || !verifyOwnerPassword(password, cfg.ownerPasswordHash)) {
    await audit({ event: 'login_fail', ok: false, ip, clientId: tx.clientId });
    return consentPage(cfg, txRaw, client.clientName, tx.redirectUri, 'Incorrect password.');
  }

  const code = randomToken(32);
  await saveCode(code, tx, AUTH_CODE_TTL_SECONDS);
  await audit({ event: 'login_ok', ok: true, ip, clientId: tx.clientId });
  return redirectWith(tx.redirectUri, { code, state: tx.state }, cfg);
}

// ─── Token endpoint ────────────────────────────────────────────────────────

async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get('content-type') ?? '';
  const text = await readTextBody(req);
  if (type.includes('application/json')) {
    const obj = JSON.parse(text || '{}');
    return new URLSearchParams(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(text);
}

// Client authentication: public clients (method "none") must not send a
// secret; confidential clients must present the one issued at registration.
async function authenticateClient(req: Request, p: URLSearchParams): Promise<{ clientId: string } | null> {
  let clientId = p.get('client_id') ?? '';
  let secret = p.get('client_secret');
  const authz = req.headers.get('authorization');
  if (authz?.startsWith('Basic ')) {
    const decoded = Buffer.from(authz.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i > 0) {
      clientId = decodeURIComponent(decoded.slice(0, i));
      secret = decodeURIComponent(decoded.slice(i + 1));
    }
  }
  const client = clientId ? await getClient(clientId) : null;
  if (!client) return null;
  if (client.tokenEndpointAuthMethod === 'none') return { clientId };
  if (!secret || !client.clientSecretHash || sha256Hex(secret) !== client.clientSecretHash) return null;
  return { clientId };
}

async function issueTokens(cfg: McpConfig, clientId: string, scope: string, familyId: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);
  const jti = randomToken(12);
  const accessToken = signJwt({
    iss: cfg.baseUrl, aud: cfg.resource, sub: 'owner', client_id: clientId, scope,
    iat: now, exp: now + ACCESS_TOKEN_TTL_SECONDS, jti, ver: cfg.tokenVersion,
  }, cfg.tokenSecret);
  const refreshToken = randomToken(32);
  await saveRefreshToken(refreshToken, { familyId, clientId, scope, resource: cfg.resource, tokenVersion: cfg.tokenVersion }, REFRESH_TOKEN_TTL_SECONDS);
  return json({
    access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken, scope,
  });
}

export async function token(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  const ip = clientIp(req);
  let p: URLSearchParams;
  try { p = await readParams(req); } catch { return oauthError('invalid_request', 'Malformed request body.'); }
  void purgeExpired();

  const client = await authenticateClient(req, p);
  if (!client) {
    await audit({ event: 'token_fail', ok: false, ip, detail: { reason: 'invalid_client' } });
    return oauthError('invalid_client', 'Client authentication failed.', 401);
  }
  const resource = p.get('resource');
  if (resource && resource !== cfg.resource) return oauthError('invalid_target', 'The resource parameter does not match this MCP server.');

  const grantType = p.get('grant_type');
  if (grantType === 'authorization_code') {
    const grant = await consumeCode(p.get('code') ?? '');
    const verifier = p.get('code_verifier') ?? '';
    const fail = async (reason: string) => {
      await audit({ event: 'token_fail', ok: false, ip, clientId: client.clientId, detail: { reason } });
      return oauthError('invalid_grant', 'The authorization code is invalid, expired, or already used.');
    };
    if (!grant) return fail('code_invalid_or_used');
    if (grant.clientId !== client.clientId) return fail('client_mismatch');
    if (grant.redirectUri !== (p.get('redirect_uri') ?? '')) return fail('redirect_mismatch');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || pkceS256(verifier) !== grant.codeChallenge) return fail('pkce_failed');
    if (grant.resource !== cfg.resource) return fail('resource_mismatch');
    await audit({ event: 'token_issued', ok: true, ip, clientId: client.clientId });
    return issueTokens(cfg, client.clientId, grant.scope, randomToken(12));
  }

  if (grantType === 'refresh_token') {
    const result = await rotateRefreshToken(p.get('refresh_token') ?? '');
    const fail = async (reason: string) => {
      await audit({ event: 'token_fail', ok: false, ip, clientId: client.clientId, detail: { reason } });
      return oauthError('invalid_grant', 'The refresh token is invalid, expired, or revoked.');
    };
    if (!result.ok) return fail(`refresh_${result.reason}`);
    if (result.grant.clientId !== client.clientId) return fail('client_mismatch');
    if (result.grant.tokenVersion !== cfg.tokenVersion) return fail('token_version_revoked');
    if (result.grant.resource !== cfg.resource) return fail('resource_mismatch');
    await audit({ event: 'token_refreshed', ok: true, ip, clientId: client.clientId });
    return issueTokens(cfg, client.clientId, result.grant.scope, result.grant.familyId);
  }

  return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
}

// RFC 7009: always 200, whether or not the token existed.
export async function revoke(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  let p: URLSearchParams;
  try { p = await readParams(req); } catch { return oauthError('invalid_request', 'Malformed request body.'); }
  const client = await authenticateClient(req, p);
  if (!client) return oauthError('invalid_client', 'Client authentication failed.', 401);
  const revoked = await revokeRefreshTokenByValue(p.get('token') ?? '');
  await audit({ event: 'token_revoked', ok: true, ip: clientIp(req), clientId: client.clientId, detail: { found: revoked } });
  return new Response(null, { status: 200, headers: NO_STORE });
}

// ─── 401 helper for the MCP endpoint ───────────────────────────────────────

export function unauthorized(cfg: McpConfig, error: 'invalid_token' | 'insufficient_scope' | null, description: string): Response {
  const parts = [`Bearer resource_metadata="${protectedResourceMetadataUrl(cfg)}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.push(`error="${error}"`, `error_description="${description.replace(/"/g, "'")}"`);
  return json({ error: error ?? 'unauthorized', error_description: description }, error === 'insufficient_scope' ? 403 : 401, {
    'WWW-Authenticate': parts.join(', '),
  });
}

// ─── Body helpers (size-capped) ────────────────────────────────────────────

const MAX_OAUTH_BODY = 16 * 1024;

async function readTextBody(req: Request): Promise<string> {
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_OAUTH_BODY) throw new Error('too large');
  const text = await req.text();
  if (text.length > MAX_OAUTH_BODY) throw new Error('too large');
  return text;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const obj = JSON.parse(await readTextBody(req));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
  return obj as Record<string, unknown>;
}
