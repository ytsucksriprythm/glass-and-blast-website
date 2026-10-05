// HTTP entry point for the MCP endpoint (/api/mcp): authenticates the bearer
// token, then hands the request to a fresh, stateless Streamable HTTP
// transport + server (no session state survives between requests, which is
// what a serverless deployment needs).

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getMcpConfig, MCP_SCOPE, MAX_REQUEST_BYTES, type McpConfig } from './config';
import { verifyJwt, type AccessTokenClaims } from './crypto';
import { unauthorized, notConfigured, json, clientIp } from './oauth';
import { audit } from './authStore';
import { buildMcpServer } from './tools';

type AuthResult = { ok: true; claims: AccessTokenClaims } | { ok: false; response: Response };

export function authenticate(req: Request, cfg: McpConfig): AuthResult {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return { ok: false, response: unauthorized(cfg, null, 'Authentication required.') };
  const claims = verifyJwt(header.slice(7).trim(), cfg.tokenSecret);
  const now = Math.floor(Date.now() / 1000);
  // Audience binding (RFC 8707): the token must have been minted for THIS
  // endpoint. Issuer, expiry and the revocation version are checked too.
  if (!claims || claims.iss !== cfg.baseUrl || claims.aud !== cfg.resource || typeof claims.exp !== 'number'
    || claims.exp <= now || claims.iat > now + 60 || claims.ver !== cfg.tokenVersion || claims.sub !== 'owner') {
    return { ok: false, response: unauthorized(cfg, 'invalid_token', 'The access token is invalid or expired.') };
  }
  if (!String(claims.scope ?? '').split(' ').includes(MCP_SCOPE)) {
    return { ok: false, response: unauthorized(cfg, 'insufficient_scope', `The ${MCP_SCOPE} scope is required.`) };
  }
  return { ok: true, claims };
}

// DNS-rebinding / cross-site protection: browsers always send Origin; ChatGPT
// calls server-to-server (no Origin). Anything else is refused.
function originAllowed(req: Request, cfg: McpConfig): boolean {
  const origin = req.headers.get('origin');
  return !origin || origin === cfg.baseUrl || origin === 'https://chatgpt.com';
}

export async function handleMcp(req: Request): Promise<Response> {
  const cfg = getMcpConfig();
  if (!cfg) return notConfigured();
  if (!originAllowed(req, cfg)) return json({ error: 'forbidden_origin' }, 403);

  const auth = authenticate(req, cfg);
  if (!auth.ok) {
    if (req.headers.get('authorization')) {
      await audit({ event: 'auth_fail', ok: false, ip: clientIp(req), detail: { reason: 'invalid_or_expired_token' } });
    }
    return auth.response;
  }

  if (req.method !== 'POST') {
    // Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE).
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_REQUEST_BYTES) return json({ error: 'request_too_large' }, 413);
  const body = await req.text();
  if (body.length > MAX_REQUEST_BYTES) return json({ error: 'request_too_large' }, 413);

  const server = buildMcpServer(cfg, { clientId: auth.claims.client_id, tokenId: auth.claims.jti, ip: clientIp(req) });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    const forwarded = new Request(req.url, { method: 'POST', headers: req.headers, body });
    return await transport.handleRequest(forwarded, {
      authInfo: { token: '[redacted]', clientId: auth.claims.client_id, scopes: auth.claims.scope.split(' '), expiresAt: auth.claims.exp },
    });
  } finally {
    // Response is fully materialized (enableJsonResponse), so closing is safe.
    void server.close();
  }
}
