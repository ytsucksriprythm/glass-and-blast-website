// Test harness for the MCP connector: an in-process Postgres (PGlite) with
//  - the REAL app schema, extracted from src/lib/db.ts's ensureSchema() (so
//    tests track the code, not a hand-maintained copy),
//  - the REAL read-only role from scripts/mcp-readonly-role.sql,
//  - seeded business data incl. LARP demo rows, DST-edge schedules, etc.
// Tools run as mcp_readonly inside READ ONLY transactions, exactly like prod.

import fs from 'fs';
import path from 'path';
import { PGlite } from '@electric-sql/pglite';
import { setMcpDbsForTesting, type ReadDb, type AuthDb, type Row } from '../../src/lib/mcp/sql';
import { hashOwnerPassword, pkceS256, randomToken } from '../../src/lib/mcp/crypto';
import * as oauth from '../../src/lib/mcp/oauth';
import { handleMcp } from '../../src/lib/mcp/handler';

const ROOT = path.join(__dirname, '..', '..');
export const BASE = 'http://localhost:3000';
export const RESOURCE = `${BASE}/api/mcp`;
export const OWNER_PASSWORD = 'correct-horse-battery-staple-test';
export const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

// One connection, so serialize everything (a read txn must never interleave with an auth write).
function mutex() {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };
}

export function schemaStatementsFromDbTs(): string[] {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/db.ts'), 'utf8');
  const body = src.slice(src.indexOf('export async function ensureSchema'), src.indexOf('// ─── JSON fallback helpers'));
  const stmts: string[] = [];
  for (const m of body.matchAll(/sql`([\s\S]*?)`/g)) {
    const s = m[1].trim();
    if (s.includes('${')) continue; // seed INSERTs with interpolated values
    if (/^(CREATE (UNIQUE )?(TABLE|INDEX)|ALTER TABLE)/i.test(s)) stmts.push(s);
  }
  return stmts;
}

let pg: PGlite;
let lock: <T>(fn: () => Promise<T>) => Promise<T>;

function plain(rows: Row[]): Row[] { return rows; }

export async function setupDb(): Promise<PGlite> {
  pg = new PGlite();
  lock = mutex();
  for (const s of schemaStatementsFromDbTs()) await pg.exec(s);
  await pg.exec(`CREATE ROLE neon_superuser NOLOGIN`);
  const roleSql = fs.readFileSync(path.join(ROOT, 'scripts/mcp-readonly-role.sql'), 'utf8')
    .replace('REPLACE_WITH_GENERATED_PASSWORD', 'test-password-not-used')
    .replace('ON DATABASE neondb', 'ON DATABASE postgres');
  await pg.exec(roleSql);

  const read: ReadDb = {
    many: queries => lock(async () => {
      await pg.exec(`SET ROLE mcp_readonly; BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;`);
      try {
        const out: Row[][] = [];
        for (const q of queries) out.push(plain((await pg.query(q.text, (q.params ?? []) as unknown[])).rows as Row[]));
        await pg.exec('COMMIT');
        return out;
      } catch (e) {
        await pg.exec('ROLLBACK');
        throw e;
      } finally {
        await pg.exec('RESET ROLE');
      }
    }),
  };
  const auth: AuthDb = { query: (text, params) => lock(async () => (await pg.query(text, (params ?? []) as unknown[])).rows as Row[]) };
  setMcpDbsForTesting({ read, auth });
  return pg;
}

export function ownerExec(sql: string, params: unknown[] = []) {
  return lock(async () => (await pg.query(sql, params)).rows as Row[]);
}

export function configureEnv(overrides: Record<string, string | undefined> = {}) {
  process.env.MCP_ENABLED = 'true';
  process.env.MCP_BASE_URL = BASE;
  process.env.MCP_TOKEN_SECRET = 'test-secret-'.padEnd(48, 'x');
  process.env.MCP_OWNER_PASSWORD_HASH ??= hashOwnerPassword(OWNER_PASSWORD);
  process.env.MCP_TOKEN_VERSION = '1';
  process.env.MCP_RATE_LIMIT_PER_10MIN = '1000';
  delete process.env.MCP_DATABASE_URL;
  delete process.env.DATABASE_URL;
  for (const [k, v] of Object.entries(overrides)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

// ─── Seed ───────────────────────────────────────────────────────────────────

export async function seed() {
  const b = (o: Record<string, unknown>) => {
    const row: Record<string, unknown> = {
      id: '', name: '', email: '', phone: '', service: 'window-washing', property_type: 'residential', address: '', suburb: '',
      preferred_date: '', preferred_time: '', notes: '', status: 'uncontacted', source: 'website', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', ...o,
    };
    const cols = Object.keys(row);
    return ownerExec(`INSERT INTO bookings (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  };
  // 60 bulk leads for pagination
  for (let i = 0; i < 60; i++) {
    await b({ id: `BK-BULK-${String(i).padStart(3, '0')}`, name: `Bulk Customer ${i}`, phone: `0400 000 ${String(i).padStart(3, '0')}`, suburb: 'Bulkville', created_at: new Date(Date.UTC(2026, 6, 1) + i * 3600_000).toISOString() });
  }
  await b({ id: 'BK-JANE', name: 'Jane Citizen', email: 'jane@example.com', phone: '+61 412 345 678', address: '12 Foo St', suburb: 'Ainslie',
    notes: 'Gate code 4321, dog in backyard', admin_notes: 'Prefers SMS. Paid cash last time.', status: 'quoted', quote_amount: 350,
    quoted_at: '2026-09-10T00:00:00Z', lead_source: 'called-us', group_id: 'GRP-1', assigned_guest_id: 'GST-1', recurring_id: 'RJ-1',
    flagged_at: '2026-09-11T00:00:00Z', flag_note: 'Cracked pane noticed', feedback_stars: 5, feedback_text: null, public_token: 'bk_tokjane' });
  await b({ id: 'BK-JANE-OLD', name: 'Jane Citizen', email: 'JANE@example.com', phone: '0412345678', address: '99 Old Rd', suburb: 'Dickson', status: 'completed', paid: true, paid_at: '2026-05-02T00:00:00Z', quote_amount: 200, created_at: '2026-04-01T00:00:00Z' });
  await b({ id: 'BK-JANE-2', name: 'Jane Smith', phone: '0499 111 222', suburb: 'Braddon', status: 'contacted' });
  // email '' (blank) vs notes NULL (never recorded)
  await b({ id: 'BK-NULLS', name: 'Null Person', email: '', notes: null, phone: '0411 222 333', source: 'facebook-lead-ad', external_lead_id: 'fb-123' });
  // DST edges. 2026-10-04 02:00 AEST → 03:00 AEDT (Sydney DST starts).
  await b({ id: 'BK-DST-A', name: 'Dst Before', phone: '0400 111 001', status: 'confirmed', scheduled_at: '2026-10-03T14:30:00Z' }); // 2026-10-04 00:30 AEST
  await b({ id: 'BK-DST-B', name: 'Dst After', phone: '0400 111 002', status: 'confirmed', scheduled_at: '2026-10-04T13:30:00Z' }); // 2026-10-05 00:30 AEDT
  await b({ id: 'BK-QV', name: 'Quote Visit', phone: '0400 111 003', status: 'quote-booked', scheduled_at: '2026-10-05T23:00:00Z', scheduled_end: '2026-10-06T00:00:00Z' }); // 10:00 AEDT 10-06
  await b({ id: 'BK-REQ', name: 'Requested Date', phone: '0400 111 004', preferred_date: '2026-10-07', status: 'contacted' });
  await b({ id: 'BK-COLD', name: 'Cold Quoted', phone: '0400 111 005', status: 'cold', quote_amount: 500 });
  await b({ id: 'BK-OWED', name: 'Owes Money', phone: '0400 111 006', status: 'completed', paid: false, quote_amount: 275, completed_at: '2026-09-20T00:00:00Z' });
  await b({ id: 'BK-DELETED', name: 'Deleted Person', phone: '0400 111 007', deleted_at: '2026-09-25T00:00:00Z' });
  await b({ id: 'LARP-1', name: 'Fake Larp Customer', phone: '0400 999 999', status: 'completed', paid: true, quote_amount: 99999 });

  await ownerExec(`INSERT INTO booking_groups (id, title) VALUES ('GRP-1', 'Ainslie street run')`);
  await ownerExec(`INSERT INTO guests (id, name, password_hash, active) VALUES ('GST-1', 'Sub Contractor', 'SECRET-HASH-MUST-NOT-LEAK', true)`);
  await ownerExec(`INSERT INTO vault_items (id, label, value) VALUES ('V-1', 'Square token', 'VAULT-SECRET-MUST-NOT-LEAK')`);
  await ownerExec(`INSERT INTO recurring_jobs (id, name, phone, email, address, suburb, service, frequency, next_date, notes, active, visit_price)
                   VALUES ('RJ-1', 'Jane Citizen', '0412 345 678', 'jane@example.com', '12 Foo St', 'Ainslie', 'window-washing', 'monthly', '2026-10-15', 'Side gate', true, 180)`);
  await ownerExec(`INSERT INTO quotes (id, number, seq, status, booking_id, services, extras, item_amounts, other_lines, amount, scope, assumptions, payment_terms, bill_to_name, quote_date, valid_until, token)
                   VALUES ('QT-1', 'Q1000', 1000, 'sent', 'BK-JANE', '["window-washing-outside","window-washing-inside"]', '["flyscreen-repair"]',
                   '{"window-washing-outside":300,"window-washing-inside":100,"flyscreen-repair":50}',
                   '[{"id":"ol-1","description":"Meta ads discount","amount":-100}]', 350, 'Outside glass. Excludes hard water staining.', 'Ground-level access', '7', 'Jane Citizen', '2026-09-10', '2026-10-10', 'qt_tokjane')`);
  await ownerExec(`INSERT INTO quotes (id, number, seq, status, booking_id, amount, token, quote_date, valid_until) VALUES ('QT-COLD', 'Q1001', 1001, 'sent', 'BK-COLD', 500, 'qt_cold', '2026-08-01', '2026-08-31')`);
  await ownerExec(`INSERT INTO invoices (id, number, seq, status, bill_to_name, invoice_date, due_date, items, subtotal, total, token, booking_ids, sent_at, paid_at, payment_method)
                   VALUES ('INV-1', 'GB1044', 1044, 'paid', 'Jane Citizen', '2026-05-01', '2026-05-08', '[{"description":"Window Cleaning","detail":"","serviceAddress":"99 Old Rd","date":"2026-05-01","amount":200}]',
                   200, 200, 'inv_tok1', '["BK-JANE-OLD"]', '2026-05-01T01:00:00Z', '2026-05-03T01:00:00Z', 'cash')`);
  await ownerExec(`INSERT INTO invoices (id, number, seq, status, bill_to_name, invoice_date, due_date, items, subtotal, total, token, booking_ids, sent_at)
                   VALUES ('INV-2', 'GB1045', 1045, 'sent', 'Owes Money', '2026-09-20', '2026-09-27', '[]', 275, 275, 'inv_tok2', '["BK-OWED"]', '2026-09-20T01:00:00Z')`);
  await ownerExec(`INSERT INTO invoices (id, number, seq, status, bill_to_name, items, subtotal, total, token) VALUES ('LARP-INV-1', 'GB9000', 9000, 'paid', 'Fake', '[]', 5000, 5000, 'larp_tok')`);
  await ownerExec(`INSERT INTO invoice_views (id, invoice_id, ip, device_type, browser, city) VALUES ('IVW-1', 'INV-1', '203.0.113.5', 'Mobile', 'Safari', 'Canberra')`);
  await ownerExec(`INSERT INTO booking_photos (id, booking_id, type, url) VALUES ('PH-1', 'BK-JANE', 'before', 'https://abc.public.blob.vercel-storage.com/booking-photos/BK-JANE/raw-secret-path.jpg')`);
  await ownerExec(`INSERT INTO activity_log (id, type, summary, meta, actor) VALUES ('ACT-1', 'booking.status_changed', 'Jane Citizen: contacted -> quoted', '{"bookingId":"BK-JANE","from":"contacted","to":"quoted"}', 'admin')`);
  await ownerExec(`INSERT INTO activity_log (id, type, summary, meta, actor) VALUES ('ACT-2', 'quote.created', 'Quote Q1000 created', '{"quoteId":"QT-1","bookingId":"BK-JANE"}', 'admin')`);
  await ownerExec(`INSERT INTO activity_log (id, type, summary, meta, actor) VALUES ('ACT-3', 'vault.created', 'Vault item saved: Square token', '{"id":"V-1"}', 'admin')`);
  await ownerExec(`INSERT INTO activity_log (id, type, summary, meta, actor, invoice_id) VALUES ('ACT-4', 'invoice.status_changed', 'GB1044 sent -> paid', '{}', 'admin', 'INV-1')`);
  await ownerExec(`INSERT INTO app_settings (id, data) VALUES ('global', '{"squareSurchargePercent":2.2,"notificationsEnabled":false}')`);
  await ownerExec(`INSERT INTO pageviews (path, referrer, visitor, max_scroll_percent, duration_seconds) VALUES ('/', 'https://google.com', 'v1', 80, 30), ('/faq', '', 'v2', null, null), ('/', '', 'larp_fake', 100, 100)`);
  await ownerExec(`INSERT INTO dismissed_leads (external_lead_id) VALUES ('fb-dismissed')`);
}

// ─── OAuth + MCP client helpers ─────────────────────────────────────────────

export function req(url: string, init: RequestInit & { form?: Record<string, string>; jsonBody?: unknown } = {}): Request {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.form) { headers.set('content-type', 'application/x-www-form-urlencoded'); body = new URLSearchParams(init.form).toString(); }
  if (init.jsonBody !== undefined) { headers.set('content-type', 'application/json'); body = JSON.stringify(init.jsonBody); }
  return new Request(url.startsWith('http') ? url : `${BASE}${url}`, { ...init, headers, body });
}

export async function registerClient(redirect = REDIRECT): Promise<string> {
  const res = await oauth.register(req('/api/oauth/register', { method: 'POST', jsonBody: { client_name: 'ChatGPT', redirect_uris: [redirect], token_endpoint_auth_method: 'none' } }));
  if (res.status !== 201) throw new Error(`register failed ${res.status} ${await res.text()}`);
  return (await res.json()).client_id;
}

export function authorizeUrl(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const p = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st-1', code_challenge: challenge, code_challenge_method: 'S256', scope: 'business.read', resource: RESOURCE, ...extra });
  return `/api/oauth/authorize?${p}`;
}

export async function getTx(clientId: string, challenge: string): Promise<string> {
  const page = await (await oauth.authorizeGet(req(authorizeUrl(clientId, challenge)))).text();
  const m = /name="tx" value="([^"]+)"/.exec(page);
  if (!m) throw new Error('no tx in page');
  return m[1].replace(/&amp;/g, '&');
}

export async function fullLogin(): Promise<{ accessToken: string; refreshToken: string; clientId: string }> {
  const clientId = await registerClient();
  const verifier = randomToken(48);
  const tx = await getTx(clientId, pkceS256(verifier));
  const res = await oauth.authorizePost(req('/api/oauth/authorize', { method: 'POST', form: { tx, password: OWNER_PASSWORD, decision: 'approve' }, headers: { 'x-forwarded-for': '198.51.100.10' } }));
  const loc = new URL(res.headers.get('location')!);
  const code = loc.searchParams.get('code')!;
  const tok = await oauth.token(req('/api/oauth/token', { method: 'POST', form: { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE } }));
  const j = await tok.json();
  if (!j.access_token) throw new Error(`token failed ${JSON.stringify(j)}`);
  return { accessToken: j.access_token, refreshToken: j.refresh_token, clientId };
}

let rpcId = 1;
export async function rpc(token: string | null, method: string, params: unknown = {}, headers: Record<string, string> = {}): Promise<Response> {
  return handleMcp(req('/api/mcp', {
    method: 'POST',
    headers: { accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    jsonBody: { jsonrpc: '2.0', id: rpcId++, method, params },
  }));
}

export async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(token, 'tools/call', { name, arguments: args });
  const body = await res.json();
  if (body.error) throw new Error(`rpc error ${JSON.stringify(body.error)}`);
  const result = body.result;
  return { isError: Boolean(result.isError), text: result.content?.[0]?.text as string, data: result.structuredContent as Record<string, any> };
}
