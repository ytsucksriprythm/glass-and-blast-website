-- Read-only Postgres role for the ChatGPT MCP connector (src/lib/mcp/*).
--
-- Run this in the Neon console SQL editor (Project → SQL Editor, database
-- `neondb`, as the project owner role). Do NOT create this role from the Neon
-- console's "Roles" page: console-created roles are made members of
-- neon_superuser, which can read and write every table. A role created with
-- plain SQL, like this, starts with no privileges at all.
--
-- 1. Replace REPLACE_WITH_GENERATED_PASSWORD with the value printed by
--      npx tsx scripts/mcp-setup-secrets.ts
--    (Neon requires a strong password; that one is 192 bits.)
-- 2. If your database isn't called neondb, change the GRANT CONNECT line.
-- 3. Run the whole script. The final SELECT must show every check as true.

CREATE ROLE mcp_readonly WITH LOGIN PASSWORD 'REPLACE_WITH_GENERATED_PASSWORD'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 20;

-- Every session defaults to read-only, with a statement time cap.
ALTER ROLE mcp_readonly SET default_transaction_read_only = on;
ALTER ROLE mcp_readonly SET statement_timeout = '15s';

GRANT CONNECT ON DATABASE neondb TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;

-- Business tables the connector reads (SELECT only).
GRANT SELECT ON
  bookings, booking_groups, booking_photos, recurring_jobs,
  invoices, invoice_views, quotes,
  payment_profiles, business_profiles, app_settings,
  activity_log, dismissed_leads, pageviews, booking_funnel_events
TO mcp_readonly;

-- Guests: everything EXCEPT password_hash (column-level grant).
GRANT SELECT (id, name, active, created_at) ON guests TO mcp_readonly;

-- Deliberately NOT granted:
--   vault_items                 (secrets store)
--   guests.password_hash        (authentication data)
--   invoice_counter, quote_counter
--   mcp_oauth_*, mcp_audit_log  (connector auth internals)
-- If a new business table is added later, grant SELECT on it here and in
-- production; scripts/mcp-verify-prod.ts reports any table not covered.

-- Verification — every column should be true.
SELECT
  NOT has_table_privilege('mcp_readonly', 'bookings', 'INSERT,UPDATE,DELETE,TRUNCATE') AS cannot_write_bookings,
  NOT has_table_privilege('mcp_readonly', 'invoices', 'INSERT,UPDATE,DELETE,TRUNCATE') AS cannot_write_invoices,
  NOT has_table_privilege('mcp_readonly', 'vault_items', 'SELECT')                   AS cannot_read_vault,
  NOT has_column_privilege('mcp_readonly', 'guests', 'password_hash', 'SELECT')      AS cannot_read_password_hash,
  NOT pg_has_role('mcp_readonly', 'neon_superuser', 'MEMBER')                        AS not_neon_superuser,
  has_table_privilege('mcp_readonly', 'bookings', 'SELECT')                          AS can_read_bookings;
