// Two separate database handles for the MCP connector:
//
//  - ReadDb: what every tool uses. Connects as the dedicated `mcp_readonly`
//    Postgres role (MCP_DATABASE_URL — SELECT-only grants, no access to the
//    vault or guest password hashes, default_transaction_read_only = on), AND
//    wraps every batch in an explicit READ ONLY transaction. Before serving
//    anything it also checks its own privileges (see assertReadOnlyRole) and
//    refuses to run if the role turns out to be able to write. So read-only is
//    enforced three times: no write tools exist, the transaction is read-only,
//    and the role itself can't write.
//
//  - AuthDb: owner connection (the app's normal DATABASE_URL), used ONLY by
//    the OAuth/audit code for its own mcp_* tables. No tool can reach it.
//
// Deliberately does NOT go through src/lib/db.ts: that module runs schema
// migrations (CREATE/ALTER/UPDATE) on first use, which a read-only role can't
// — and shouldn't — do.

import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;
export interface Query { text: string; params?: unknown[] }

export interface ReadDb {
  // All queries run in ONE read-only, repeatable-read transaction, so a
  // multi-query tool (e.g. a page + its total count) sees one consistent snapshot.
  many(queries: Query[]): Promise<Row[][]>;
}
export interface AuthDb {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

interface TestDbs { read: ReadDb; auth: AuthDb }
const g = globalThis as { __MCP_TEST_DBS__?: TestDbs };

// Test harness hook — tests inject an in-process Postgres (PGlite) here.
export function setMcpDbsForTesting(dbs: TestDbs | undefined): void {
  g.__MCP_TEST_DBS__ = dbs;
  readOnlyChecked = null;
}

let readDb: ReadDb | null = null;
let readDbUrl = '';

export function getReadDb(url: string): ReadDb {
  if (g.__MCP_TEST_DBS__) return g.__MCP_TEST_DBS__.read;
  if (!readDb || readDbUrl !== url) {
    const sql = neon(url);
    readDb = {
      async many(queries) {
        if (!queries.length) return [];
        const results = await sql.transaction(
          tx => queries.map(q => tx.query(q.text, q.params ?? [])),
          { readOnly: true, isolationLevel: 'RepeatableRead' },
        );
        return results as unknown as Row[][];
      },
    };
    readDbUrl = url;
  }
  return readDb;
}

let authDb: AuthDb | null = null;

export function getAuthDb(): AuthDb {
  if (g.__MCP_TEST_DBS__) return g.__MCP_TEST_DBS__.auth;
  if (!authDb) {
    // Same connection preference as src/lib/db.ts (the HTTP driver wants the
    // direct/unpooled endpoint).
    const conn = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING
      || process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!conn) throw new Error('No owner database connection configured for MCP auth storage');
    const sql = neon(conn);
    authDb = { query: (text, params) => sql.query(text, params ?? []) as Promise<Row[]> };
  }
  return authDb;
}

export async function readOne(db: ReadDb, text: string, params?: unknown[]): Promise<Row[]> {
  const [rows] = await db.many([{ text, params }]);
  return rows;
}

// ─── Runtime read-only self-check ───────────────────────────────────────────
// Fails closed if the role behind MCP_DATABASE_URL can modify anything we
// know about, can read the vault, can read guest password hashes, or isn't
// defaulting to read-only transactions. Cached per server instance.

const WRITE_CHECK_TABLES = [
  'bookings', 'booking_groups', 'booking_photos', 'recurring_jobs', 'invoices', 'quotes',
  'payment_profiles', 'business_profiles', 'app_settings', 'activity_log', 'invoice_views',
  'dismissed_leads', 'pageviews', 'booking_funnel_events', 'guests', 'vault_items',
  'invoice_counter', 'quote_counter',
];

let readOnlyChecked: Promise<void> | null = null;

export class ReadOnlyViolation extends Error {}

export function assertReadOnlyRole(db: ReadDb): Promise<void> {
  if (!readOnlyChecked) {
    readOnlyChecked = (async () => {
      const writeChecks = WRITE_CHECK_TABLES.map(t =>
        `(to_regclass('public.${t}') IS NOT NULL AND has_table_privilege(current_user, 'public.${t}', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))`,
      ).join(' OR ');
      const [rows] = await db.many([{
        text: `SELECT
          current_user AS role,
          (${writeChecks}) AS can_write,
          (to_regclass('public.vault_items') IS NOT NULL AND has_table_privilege(current_user, 'public.vault_items', 'SELECT')) AS can_read_vault,
          (to_regclass('public.guests') IS NOT NULL AND has_column_privilege(current_user, 'public.guests', 'password_hash', 'SELECT')) AS can_read_password_hash,
          (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS has_admin_attrs,
          has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
          current_setting('transaction_read_only') AS txn_read_only`,
      }]);
      const r = rows[0] ?? {};
      const problems: string[] = [];
      if (r.can_write) problems.push('role has write privileges on business tables');
      if (r.can_read_vault) problems.push('role can read vault_items');
      if (r.can_read_password_hash) problems.push('role can read guests.password_hash');
      if (r.has_admin_attrs) problems.push('role has superuser/createrole/createdb/bypassrls');
      if (r.can_create) problems.push('role can CREATE in schema public');
      if (r.txn_read_only !== 'on') problems.push('transaction is not read-only');
      if (problems.length) throw new ReadOnlyViolation(`MCP read role failed safety check: ${problems.join('; ')}`);
    })();
    // Don't cache a failure forever — a fixed role should start working
    // without a redeploy.
    readOnlyChecked.catch(() => { readOnlyChecked = null; });
  }
  return readOnlyChecked;
}
