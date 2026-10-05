# Glass & Blast → ChatGPT (remote MCP connector)

Read-only access for ChatGPT to **all** Glass & Blast business records, from the
live admin database, over an authenticated remote MCP endpoint.

- **Endpoint (once deployed):** `https://glassandblast.com.au/api/mcp`
- **Transport:** MCP Streamable HTTP, stateless, JSON responses
- **Auth:** OAuth 2.1 (authorization code + PKCE S256, dynamic client registration, resource-bound tokens). One authorised account: the business owner, signing in with the connector password.
- **Code:** `src/lib/mcp/*`, routes in `src/app/api/mcp`, `src/app/api/oauth/*`, `src/app/api/mcp-files/photo`, `src/app/.well-known/*`
- **Tests:** `npm run test:mcp` (34 tests, in-process Postgres with the real schema and role) · production check: `npx tsx scripts/mcp-verify-prod.ts`

The older `mcp-server/` (local stdio connector for Claude Desktop) is separate and unchanged.

---

## Architecture

```
ChatGPT ──HTTPS──▶ /api/mcp  (Next.js route on Vercel, same app as the site)
   │                 │ 1. Bearer JWT check: signature, issuer, audience = this endpoint,
   │                 │    expiry, scope business.read, revocation version
   │                 │ 2. Origin check, 64 KB body cap, per-client rate limit
   │                 │ 3. Read-only tools → src/lib/mcp/data.ts
   │                 ▼
   │           Neon Postgres as role mcp_readonly (SELECT-only grants,
   │           default read-only), every batch in a READ ONLY transaction,
   │           runtime privilege self-check before serving anything
   │
   └─OAuth──▶ /.well-known/oauth-protected-resource[/api/mcp]   (RFC 9728)
              /.well-known/oauth-authorization-server            (RFC 8414)
              /api/oauth/register   (DCR, ChatGPT redirect URIs only)
              /api/oauth/authorize  (owner password page → single-use code)
              /api/oauth/token      (PKCE S256; rotating refresh tokens)
              /api/oauth/revoke
              └─ state in mcp_oauth_* tables + mcp_audit_log (owner connection;
                 the tool role cannot see these tables)
```

**Read-only is enforced in four places:**
1. No write tools are registered (all 18 carry `readOnlyHint: true`).
2. Every query runs in a `READ ONLY` transaction.
3. The `mcp_readonly` role only has `SELECT` on business tables. It has no access to the vault, guest password hashes, counters or `mcp_*` tables.
4. Before serving any data, each server instance checks its own privileges and refuses to run if the role can write, read the vault or password hashes, create objects, or isn't read-only.

**Secrets stay server-side.**
- The connector has its own password and signing key, separate from `ADMIN_PASSWORD` and `ADMIN_SECRET`.
- Codes, refresh tokens and client secrets are stored only as SHA-256 hashes.
- The owner password is stored as a scrypt hash.
- Tool errors return generic messages; details go only to server logs.
- No SQL, shell or URL-fetching tool exists. The photo proxy only ever fetches the stored URL for a signed photo id, and only from `*.public.blob.vercel-storage.com`.

**Audit trail (`mcp_audit_log`).** Records client registrations, sign-ins (success, failure, lockout), token issue/refresh/revoke and failures, every tool call (tool, sanitised arguments, result count, duration), rate-limit hits and photo views. Free-text search terms are stored as a length plus a hash, never as plain text, and tokens and passwords are never logged. To read it, run this in Neon:

```sql
SELECT created_at, event, ok, tool, detail, result_count FROM mcp_audit_log ORDER BY id DESC LIMIT 100;
```

## Costs

| Item | Cost |
|---|---|
| Vercel functions for `/api/mcp` + OAuth (same project) | $0 extra at this volume. Caveat: Vercel **Hobby** is licensed for non-commercial use; a business site should be on **Pro (US$20/mo)**. That's true today, independent of this connector. |
| Neon (one extra read-only role, 4 small tables) | $0 (well inside the current plan) |
| ChatGPT | Requires a paid plan with Developer mode: Plus, Pro, Business, Enterprise or Edu |

---

## Deployment

> Deploying needs your explicit go-ahead. Nothing below has been run against production yet.

### 1. Generate secrets (on your PC)
```bash
npx tsx scripts/mcp-setup-secrets.ts
```
This prints your **connector sign-in password** (save it in your password manager), `MCP_OWNER_PASSWORD_HASH`, `MCP_TOKEN_SECRET`, and a **DB role password**. Nothing is written to disk.

### 2. Create the read-only DB role (Neon console)
1. Open console.neon.tech → your project → **SQL Editor** (database `neondb`).
2. Paste `scripts/mcp-readonly-role.sql`.
3. Replace `REPLACE_WITH_GENERATED_PASSWORD` with the DB role password from step 1.
4. Run it. The final row must show every column `true`.

Use the SQL editor, **not** the Roles page: roles created on the Roles page become `neon_superuser` members, which can write.

### 3. Build `MCP_DATABASE_URL`
1. In Neon, go to **Connect**, toggle **Connection pooling OFF**, and copy the connection string.
2. Replace the user and password with `mcp_readonly` and its password:
   ```
   postgresql://mcp_readonly:<db-role-password>@<ep-xxxx>.<region>.aws.neon.tech/neondb?sslmode=require
   ```

### 4. Vercel → Project → Settings → Environment Variables (Production, mark Sensitive)

| Name | Value |
|---|---|
| `MCP_ENABLED` | `true` (set `false` any time to switch the connector off instantly) |
| `MCP_BASE_URL` | `https://glassandblast.com.au` |
| `MCP_TOKEN_SECRET` | from step 1 |
| `MCP_OWNER_PASSWORD_HASH` | from step 1 (format `scrypt:…`) |
| `MCP_DATABASE_URL` | from step 3 |
| `MCP_TOKEN_VERSION` | optional, default `1`. Change it (e.g. to `2`) to instantly revoke every issued token. |
| `MCP_RATE_LIMIT_PER_10MIN` | optional, default `300` tool calls per client per 10 min |
| `MCP_EXTRA_REDIRECT_URIS` | optional, comma-separated; only for testing with another MCP client |

These existing variables are also used: `DATABASE_URL`/`DATABASE_URL_UNPOOLED` (for the OAuth/audit tables, which are created automatically), plus `META_LEADS_SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON` (only for the live sheet check).

### 5. Deploy and verify
1. Commit and push; Vercel deploys.
2. Run these checks:
   ```bash
   curl -s https://glassandblast.com.au/.well-known/oauth-protected-resource/api/mcp
   ```
   ```bash
   curl -si -X POST https://glassandblast.com.au/api/mcp
   ```
   The first must return JSON with `"resource": "https://glassandblast.com.au/api/mcp"`. The second must return **401** with a `WWW-Authenticate: Bearer resource_metadata=…` header and no data.
3. Optionally, set `MCP_DATABASE_URL` locally and run `npx tsx scripts/mcp-verify-prod.ts`. It also runs the role safety check.

---

## Connecting ChatGPT

Per OpenAI's current docs ([Connect from ChatGPT](https://developers.openai.com/apps-sdk/deploy/connect-chatgpt), [Auth](https://developers.openai.com/apps-sdk/build/auth)). ChatGPT's menu labels change from time to time; if one doesn't match, look for the nearest equivalent.

1. **Turn on Developer mode.** In ChatGPT (web), go to **Settings → Security and login** (on some accounts it's under **Apps & Connectors → Advanced settings**) and turn on **Developer mode**. On Business/Enterprise workspaces an admin may need to allow it first.
2. **Create the connection.** Go to Settings → **Apps & Connectors** (shown as *Plugins* in newer builds) and click **Create / +**.
   - **Name:** `Glass & Blast`
   - **Description:** `Read-only access to Glass & Blast customers, bookings, quotes, invoices and reports`
   - **Connection:** Public endpoint, `https://glassandblast.com.au/api/mcp`
   - **Authentication:** OAuth. Leave the client ID and secret blank; ChatGPT registers itself automatically.
3. Click **Create**. ChatGPT opens the **Glass & Blast sign-in page**.
   - Check that the page says the request is from `chatgpt.com`.
   - Enter your connector password and click **Allow read-only access**.
4. ChatGPT lists the 18 tools. In a new chat, enable the Glass & Blast app/connector from the composer's tools menu (Developer mode).
5. **After any connector update:** open the connection, click **Refresh**, and start a new chat.

**Disconnecting / revoking.**
- Remove the connection in ChatGPT.
- To cut off every issued token at once, bump `MCP_TOKEN_VERSION`.
- To shut the connector down entirely, set `MCP_ENABLED=false`.

**About OpenAI's side.** Data returned to ChatGPT is processed under your OpenAI account's data controls. Turn off "Improve the model for everyone" if you don't want conversations used for training.

---

## Coverage checklist

Verified on 2026-10-05:
- **Tests:** the test suite runs against the real schema extracted from `src/lib/db.ts`.
- **Production:** `scripts/mcp-verify-prod.ts` ran read-only against production. It covered 18 tables and 219 columns. The live data included 178 bookings, 13 trashed bookings, 40 invoices, 79 quotes, 1 recurring plan, 884 activity entries and 92 payment events. Every record was reachable via pagination and fully retrievable, with all columns present.

### Database tables → tools

Tools return **every column** of each table (generic mapping, so a column added later appears automatically) except where noted.

| Table | Tools | Excluded columns |
|---|---|---|
| `bookings` (customers, leads, quote visits, jobs; incl. `notes` = customer notes, `admin_notes` = private notes, flags, feedback, assignment, calendar slot, soft-deleted) | `search_bookings`, `get_booking`, `get_customer_history`, `list_schedule`, `get_report`, `search_everything` | none |
| `quotes` (numbers, dates, line items, scope/exclusions, assumptions, discounts, payment terms, totals, status, public link) | `list_quotes`, `get_quote`, `get_booking` | none |
| `invoices` (numbers, line items, totals, due dates, status, payment method, Square fields, bank details, DVA block, public link) | `list_invoices`, `get_invoice`, `list_payments`, `get_booking` | none |
| `invoice_views` (customer view log) | `get_invoice` | none |
| `recurring_jobs` | `list_recurring_plans`, `get_recurring_plan`, `list_schedule` | none |
| `booking_photos` | `get_photo_links`, `get_booking` | `url` → replaced by a 15-minute signed link |
| `booking_groups` | `get_booking`, `get_business_settings` | none |
| `activity_log` | `list_activity`, `get_booking`, `get_quote`, `get_invoice` | `vault.*` entries: summary/meta redacted |
| `guests` (subcontractors) | `get_business_settings`, `get_booking`, `get_invoice` | `password_hash` (never) |
| `app_settings` | `get_business_settings` | none |
| `business_profiles`, `payment_profiles` | `get_business_settings` | none |
| `dismissed_leads` | `get_facebook_lead_sync_status` | none |
| `pageviews`, `booking_funnel_events` | `get_report` (`site_traffic`), aggregated | individual rows not listed (anonymous hashes) |
| `vault_items` | **excluded** | secrets store |
| `invoice_counter`, `quote_counter` | **excluded** | internal counters only |
| `mcp_*` | **excluded** | connector auth internals |

### Admin sections → tools

| Admin section | Tools |
|---|---|
| Dashboard overview (totals, statuses, revenue, owed, upcoming, leads by month) | `get_report` overview, `list_schedule` |
| Bookings & Quotes (Leads/Pipeline) | `search_bookings`, `get_report` pipeline |
| Business stats | `get_report` business, revenue_by_month |
| Site stats | `get_report` site_traffic |
| Booking detail page | `get_booking`, `get_photo_links` |
| Calendar | `list_schedule` |
| Quotes | `list_quotes`, `get_quote` |
| Invoices (incl. view log, Square) | `list_invoices`, `get_invoice`, `list_payments` |
| Recurring plans | `list_recurring_plans`, `get_recurring_plan`, `list_schedule` recurring_projected |
| Guests page | `get_business_settings`, `search_bookings` assignedGuestId, `list_invoices` ownerGuestId |
| Settings: autofill profiles, address display, Square, notifications, reviews, scheduling, public site, LARP toggles | `get_business_settings` |
| Settings: Facebook lead sync | `get_facebook_lead_sync_status` (with `checkSheet` for a live sheet comparison) |
| Settings: Deleted bookings | `search_bookings` deleted="only" |
| Settings: Activity log | `list_activity` |
| Settings: Export bookings | `search_bookings` (page through all) |
| Settings: **Media library** | **Not exposed.** Files live in Vercel Blob, not the DB, and are public marketing assets. Can be added. |
| Settings: **Vault** | **Excluded** by design |
| LARP demo data | Excluded from every tool |

### Requested but not recorded by the admin (limitations)
- **Quote acceptance:** not stored (quotes are only `draft`/`sent`). `get_quote` infers it from the booking status.
- **Access instructions:** no field; they live in notes/adminNotes and quote assumptions, which are returned in full.
- **Assigned staff:** only subcontractor ("guest") assignment exists.
- **Tax:** not GST-registered, so no tax amounts exist. Reported as GST 0 with the compliance note.
- **Payment history, amounts paid, outstanding balances:** there's no ledger and no partial payments. These are derived from invoice and booking fields (`list_payments`, `get_invoice`).
- **Attachments:** only job photos exist.
- **Facebook sync runs:** not recorded, so there's no last-run time or error history. Status is derived from imported leads, plus an optional live sheet check.
- **Customer record:** there's no customer table. `get_customer_history` groups records by phone, email or exact address and says what each record matched on.
- **Photos at rest:** the existing Blob store is public-access, so the stored photo URLs are permanent unguessable links (that's how the admin uses them today). The connector never reveals them. Making them truly private means migrating the Blob store, which is a separate change.

### Data conventions
- **IDs:** `BK-…` bookings, `QT-…`/`Q1000+` quotes, `INV-…`/`GB1044+` invoices, `RJ-…` plans, `PH-…` photos, `ACT-…` activity.
- **Missing vs blank:** `null` means never recorded; `""` means saved blank.
- **Timestamps:** ISO UTC as stored, plus a Sydney rendering under `computed`.
- **Date filters:** Australia/Sydney local dates, inclusive, with daylight saving handled per date.
- **Pagination:** every list returns `total`, `hasMore` and `nextCursor`. Cursors are signed and bound to their filters, with a snapshot time so new rows don't shift pages.

---

## Example prompts

**Finding leads**
- "Show every Facebook lead from the last 14 days that's still uncontacted, with phone numbers and suburbs."
- "Find all leads in Ainslie or Braddon received in September. Page through all of them."
- "Who is Jane? If there's more than one, list them and ask me which."
- "Show the complete record for booking BK-1759… including private notes and history."

**Checking schedules**
- "What jobs and quote visits do I have tomorrow? Include addresses, times, and any gate or access notes."
- "List everything scheduled next week, split into jobs and quote visits."
- "Which customers asked for a date this month but haven't been put in the calendar?"
- "What recurring plan visits are coming up before Christmas?"

**Reading notes and history**
- "Read me all the notes and private admin notes for the Smith job at 12 Foo St."
- "What's the full history for customer 0412 345 678: every booking, quote and invoice?"
- "Show the activity log for invoice GB1050 and when the customer opened it."

**Quoted but not booked**
- "Which customers have I quoted who haven't booked yet? Oldest first, with the quote amount and days since quoting."
- "Of the quoted-but-not-booked customers, which ones went cold, and what were their quotes?"

**Money**
- "What's owed to me right now, from completed unpaid jobs and unpaid invoices?"
- "Revenue by month for the last 12 months."
- "List overdue invoices with the customer's phone number."

---

## Write tools

Proposed, not enabled. See `docs/mcp-write-tools-proposal.md`. None of them are registered; the connector cannot change anything.
