// Remote MCP connector (ChatGPT) configuration. Everything here comes from
// env vars — nothing secret is hardcoded, and the connector fails closed
// (every endpoint answers 503) unless it's explicitly enabled and fully
// configured. See docs/mcp-chatgpt.md for what each variable is for.
//
// Deliberately independent of ADMIN_PASSWORD / ADMIN_SECRET: the connector
// has its own owner password and its own token-signing key, so rotating or
// leaking one never affects the other.

export const MCP_SCOPE = 'business.read';
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;            // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SECONDS = 5 * 60;
export const AUTHORIZE_FORM_TTL_SECONDS = 10 * 60;
export const FILE_LINK_TTL_SECONDS = 15 * 60;
export const MAX_REQUEST_BYTES = 64 * 1024;

// ChatGPT's OAuth callbacks (OpenAI Apps SDK auth docs). The stable URI is
// used when the authorization server advertises issuer identification
// (authorization_response_iss_parameter_supported: true — we do); the
// per-connector form is accepted too in case ChatGPT falls back to it.
export const CHATGPT_STABLE_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const CHATGPT_CONNECTOR_REDIRECT = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,200}$/;

export interface McpConfig {
  baseUrl: string;       // issuer, e.g. https://glassandblast.com.au (no trailing slash)
  resource: string;      // canonical MCP endpoint URL — also the token audience
  tokenSecret: string;
  ownerPasswordHash: string;
  readDatabaseUrl: string;
  tokenVersion: string;
  extraRedirectUris: string[];
  toolCallsPer10Min: number;
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

// Returns null when the connector is disabled or any required setting is
// missing/weak. Callers turn null into a generic 503 — they never say which
// setting is missing, so an unauthenticated caller learns nothing.
export function getMcpConfig(): McpConfig | null {
  if (process.env.MCP_ENABLED !== 'true') return null;
  const baseUrl = trimSlash(process.env.MCP_BASE_URL ?? '');
  const tokenSecret = process.env.MCP_TOKEN_SECRET ?? '';
  const ownerPasswordHash = process.env.MCP_OWNER_PASSWORD_HASH ?? '';
  const readDatabaseUrl = process.env.MCP_DATABASE_URL ?? '';
  if (!/^https?:\/\/[^/]+$/.test(baseUrl)) return null;
  // Plain http is only acceptable for local testing.
  if (baseUrl.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl)) return null;
  if (tokenSecret.length < 32) return null;
  if (!ownerPasswordHash.startsWith('scrypt:')) return null;
  if (!readDatabaseUrl && !testOverrideActive()) return null;
  return {
    baseUrl,
    resource: `${baseUrl}/api/mcp`,
    tokenSecret,
    ownerPasswordHash,
    readDatabaseUrl,
    tokenVersion: process.env.MCP_TOKEN_VERSION || '1',
    extraRedirectUris: (process.env.MCP_EXTRA_REDIRECT_URIS ?? '').split(',').map(s => s.trim()).filter(Boolean),
    toolCallsPer10Min: Math.max(10, Number(process.env.MCP_RATE_LIMIT_PER_10MIN) || 300),
  };
}

// Set by the test harness only (see src/lib/mcp/sql.ts) — lets tests run
// against an in-process Postgres without a connection string.
function testOverrideActive(): boolean {
  return (globalThis as { __MCP_TEST_DBS__?: unknown }).__MCP_TEST_DBS__ !== undefined;
}

export function isAllowedRedirectUri(uri: string, cfg: McpConfig): boolean {
  if (uri === CHATGPT_STABLE_REDIRECT || CHATGPT_CONNECTOR_REDIRECT.test(uri)) return true;
  return cfg.extraRedirectUris.includes(uri);
}

export function protectedResourceMetadataUrl(cfg: McpConfig): string {
  return `${cfg.baseUrl}/.well-known/oauth-protected-resource/api/mcp`;
}
