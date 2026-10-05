// Storage for the connector's own OAuth state and audit trail: registered
// clients, single-use authorization codes, refresh tokens, and the audit log
// (which doubles as the rate-limit counter). Lives in mcp_* tables on the
// owner connection — the read-only role used by tools is never granted access
// to these, and no tool can call into this module.
//
// Secrets are only ever stored hashed (codes, refresh tokens, client secrets).
// The audit log never stores tokens, passwords, or free-text search terms.

import { getAuthDb, type Row } from './sql';
import { sha256Hex } from './crypto';

let ready: Promise<void> | null = null;

export function ensureAuthTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = getAuthDb();
      await db.query(`CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
        client_id                  TEXT PRIMARY KEY,
        client_secret_hash         TEXT,
        client_name                TEXT NOT NULL DEFAULT '',
        redirect_uris              TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL,
        created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
        revoked_at                 TIMESTAMPTZ
      )`);
      await db.query(`CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
        code_hash      TEXT PRIMARY KEY,
        client_id      TEXT NOT NULL,
        redirect_uri   TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scope          TEXT NOT NULL,
        resource       TEXT NOT NULL,
        expires_at     TIMESTAMPTZ NOT NULL,
        used_at        TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await db.query(`CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
        token_hash    TEXT PRIMARY KEY,
        family_id     TEXT NOT NULL,
        client_id     TEXT NOT NULL,
        scope         TEXT NOT NULL,
        resource      TEXT NOT NULL,
        token_version TEXT NOT NULL,
        expires_at    TIMESTAMPTZ NOT NULL,
        rotated_at    TIMESTAMPTZ,
        revoked_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await db.query(`CREATE INDEX IF NOT EXISTS mcp_refresh_family_idx ON mcp_oauth_refresh_tokens (family_id)`);
      await db.query(`CREATE TABLE IF NOT EXISTS mcp_audit_log (
        id           BIGSERIAL PRIMARY KEY,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        event        TEXT NOT NULL,
        ok           BOOLEAN NOT NULL,
        client_id    TEXT,
        token_id     TEXT,
        ip           TEXT,
        tool         TEXT,
        detail       TEXT,
        result_count INTEGER,
        duration_ms  INTEGER
      )`);
      await db.query(`CREATE INDEX IF NOT EXISTS mcp_audit_event_idx ON mcp_audit_log (event, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS mcp_audit_ip_idx ON mcp_audit_log (ip, created_at DESC)`);
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

async function q(text: string, params?: unknown[]): Promise<Row[]> {
  await ensureAuthTables();
  return getAuthDb().query(text, params);
}

// ─── Clients (dynamic client registration) ──────────────────────────────────

export interface OAuthClient {
  clientId: string;
  clientSecretHash: string | null;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic';
}

export async function saveClient(c: OAuthClient): Promise<void> {
  await q(
    `INSERT INTO mcp_oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method)
     VALUES ($1, $2, $3, $4, $5)`,
    [c.clientId, c.clientSecretHash, c.clientName, JSON.stringify(c.redirectUris), c.tokenEndpointAuthMethod],
  );
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  const rows = await q(`SELECT * FROM mcp_oauth_clients WHERE client_id = $1 AND revoked_at IS NULL`, [clientId]);
  const r = rows[0];
  if (!r) return null;
  let redirectUris: string[] = [];
  try { redirectUris = JSON.parse(String(r.redirect_uris)); } catch { /* treat as none */ }
  return {
    clientId: String(r.client_id),
    clientSecretHash: (r.client_secret_hash as string | null) ?? null,
    clientName: String(r.client_name ?? ''),
    redirectUris,
    tokenEndpointAuthMethod: r.token_endpoint_auth_method as OAuthClient['tokenEndpointAuthMethod'],
  };
}

// ─── Authorization codes (single use) ──────────────────────────────────────

export interface CodeGrant {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}

export async function saveCode(code: string, grant: CodeGrant, ttlSeconds: number): Promise<void> {
  await q(
    `INSERT INTO mcp_oauth_codes (code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [sha256Hex(code), grant.clientId, grant.redirectUri, grant.codeChallenge, grant.scope, grant.resource, String(ttlSeconds)],
  );
}

// Atomically marks the code used; a second redemption (or an expired code)
// returns null. Single-use is enforced by the WHERE used_at IS NULL guard.
export async function consumeCode(code: string): Promise<CodeGrant | null> {
  const rows = await q(
    `UPDATE mcp_oauth_codes SET used_at = now()
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING client_id, redirect_uri, code_challenge, scope, resource`,
    [sha256Hex(code)],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    clientId: String(r.client_id), redirectUri: String(r.redirect_uri), codeChallenge: String(r.code_challenge),
    scope: String(r.scope), resource: String(r.resource),
  };
}

// ─── Refresh tokens (rotating, family-revocable) ───────────────────────────

export interface RefreshGrant {
  familyId: string;
  clientId: string;
  scope: string;
  resource: string;
  tokenVersion: string;
}

export async function saveRefreshToken(token: string, g: RefreshGrant, ttlSeconds: number): Promise<void> {
  await q(
    `INSERT INTO mcp_oauth_refresh_tokens (token_hash, family_id, client_id, scope, resource, token_version, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' seconds')::interval)`,
    [sha256Hex(token), g.familyId, g.clientId, g.scope, g.resource, g.tokenVersion, String(ttlSeconds)],
  );
}

export type RotateResult =
  | { ok: true; grant: RefreshGrant }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' };

// Marks the presented refresh token rotated. Presenting an already-rotated
// token means it leaked (or a client bug): the whole family is revoked.
export async function rotateRefreshToken(token: string): Promise<RotateResult> {
  const hash = sha256Hex(token);
  const rows = await q(
    `UPDATE mcp_oauth_refresh_tokens SET rotated_at = now()
     WHERE token_hash = $1 AND rotated_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     RETURNING family_id, client_id, scope, resource, token_version`,
    [hash],
  );
  if (rows[0]) {
    const r = rows[0];
    return { ok: true, grant: {
      familyId: String(r.family_id), clientId: String(r.client_id), scope: String(r.scope),
      resource: String(r.resource), tokenVersion: String(r.token_version),
    } };
  }
  const existing = await q(`SELECT family_id, rotated_at, revoked_at, expires_at FROM mcp_oauth_refresh_tokens WHERE token_hash = $1`, [hash]);
  const e = existing[0];
  if (!e) return { ok: false, reason: 'unknown' };
  if (e.revoked_at) return { ok: false, reason: 'revoked' };
  if (e.rotated_at) {
    await revokeFamily(String(e.family_id));
    return { ok: false, reason: 'reused' };
  }
  return { ok: false, reason: 'expired' };
}

export async function revokeFamily(familyId: string): Promise<void> {
  await q(`UPDATE mcp_oauth_refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [familyId]);
}

export async function revokeRefreshTokenByValue(token: string): Promise<boolean> {
  const rows = await q(`SELECT family_id FROM mcp_oauth_refresh_tokens WHERE token_hash = $1`, [sha256Hex(token)]);
  if (!rows[0]) return false;
  await revokeFamily(String(rows[0].family_id));
  return true;
}

// ─── Audit log + rate limiting ─────────────────────────────────────────────

export interface AuditEvent {
  event: string;
  ok: boolean;
  clientId?: string | null;
  tokenId?: string | null;
  ip?: string | null;
  tool?: string | null;
  detail?: Record<string, unknown> | null;
  resultCount?: number | null;
  durationMs?: number | null;
}

// Best-effort: an audit write failing must never break (or leak through) the
// caller's response — but it IS logged to stderr so it's visible in Vercel.
export async function audit(e: AuditEvent): Promise<void> {
  try {
    await q(
      `INSERT INTO mcp_audit_log (event, ok, client_id, token_id, ip, tool, detail, result_count, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [e.event, e.ok, e.clientId ?? null, e.tokenId ?? null, e.ip ?? null, e.tool ?? null,
        e.detail ? JSON.stringify(e.detail).slice(0, 4000) : null, e.resultCount ?? null, e.durationMs ?? null],
    );
  } catch (err) {
    console.error('[mcp] audit write failed:', err instanceof Error ? err.message : 'unknown error');
  }
}

export async function countEvents(event: string, sinceSeconds: number, filter?: { ip?: string; clientId?: string }): Promise<number> {
  const params: unknown[] = [event, String(sinceSeconds)];
  let where = `event = $1 AND created_at > now() - ($2 || ' seconds')::interval`;
  if (filter?.ip) { params.push(filter.ip); where += ` AND ip = $${params.length}`; }
  if (filter?.clientId) { params.push(filter.clientId); where += ` AND client_id = $${params.length}`; }
  const rows = await q(`SELECT count(*)::int AS n FROM mcp_audit_log WHERE ${where}`, params);
  return Number(rows[0]?.n ?? 0);
}

// Housekeeping, called opportunistically from the token endpoint.
export async function purgeExpired(): Promise<void> {
  try {
    await q(`DELETE FROM mcp_oauth_codes WHERE expires_at < now() - interval '1 day'`);
    await q(`DELETE FROM mcp_oauth_refresh_tokens WHERE expires_at < now() - interval '7 days'`);
  } catch { /* best effort */ }
}
