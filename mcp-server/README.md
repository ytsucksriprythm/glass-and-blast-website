# Glass & Blast — MCP connector for Claude Desktop

A read-only [MCP](https://modelcontextprotocol.io) server that lets Claude Desktop
answer questions about the business directly from live production data
(bookings, invoices, recurring plans, guests, site traffic) — no dashboard
required.

**Read-only.** Every tool only ever calls a `get*`/`list*` function from
`src/lib/db.ts`. There is no create/update/delete path — Claude cannot change
anything through this connector.

**LARP mode aware.** LARP ("make us look busy") demo mode fills the database
with fake bookings/invoices/recurring plans/page views tagged `LARP-`/`larp_`.
Every tool here filters those out before computing anything, and every
response includes a `_demoData` block reporting whether LARP mode currently
has fake rows live and how many were excluded — so if you ask Claude about
the business while LARP mode happens to be on for a demo, it still reports
the real numbers instead of the inflated ones, without anything about the
admin UI itself changing. Use the dedicated `get_larp_mode_status` tool any
time you want to check that directly.

## Tools

| Tool | What it returns |
|---|---|
| `list_bookings` | Real bookings, filterable by `status` / `search` / `limit` |
| `get_booking` | Full detail for one booking by id |
| `get_dashboard_stats` | Counts + status breakdown + revenue, like the Dashboard tab |
| `get_business_stats` | Conversion rate, avg quote, top suburbs, debtor days, overdue invoices |
| `get_site_stats` | Last-30-days public site traffic, like the Site Stats tab |
| `list_invoices` | Real invoices, filterable by `status` / `limit` |
| `get_invoice` | Full detail for one invoice by id |
| `list_recurring_plans` | Recurring job plans (`activeOnly` default true) |
| `list_guests` | Guest/subcontractor accounts (never returns password hashes) |
| `get_larp_mode_status` | Whether demo data is currently live, and how much of it |

## Setup

**Transport: Streamable HTTP, not stdio.** The build of Claude Desktop this
was built against only supports adding custom connectors by URL ("Add custom
connector" → "Remote MCP server URL") — there's no field for a local command
to spawn. So this server runs as a small local HTTP server on
`127.0.0.1:8420` instead of the more common stdio-spawned-by-the-client
pattern. It's bound to localhost only, with the SDK's built-in DNS-rebinding
protection, so nothing outside this machine can reach it.

1. **Install dependencies** (once, from the repo root):
   ```
   npm install
   ```
2. **Make sure `.env.local` has a working `DATABASE_URL`** (or
   `DATABASE_URL_UNPOOLED`) — the server reads production Neon data through
   the same `.env.local` the Next.js app uses. It loads that file itself, so
   you don't need to duplicate the connection string anywhere else.
3. **Start the server** and leave it running in a terminal whenever you want
   to use it from Claude Desktop:
   ```
   npm run mcp
   ```
   It prints the connector URL: `http://127.0.0.1:8420/mcp`
4. **In Claude Desktop**, open Settings → Connectors → **Add custom
   connector**, name it (e.g. `glass-and-blast`), and paste that URL into
   the "Remote MCP server URL" field. Click Add.
5. It should immediately show as connected, with the 10 tools above
   available in chat — no restart needed. If the server isn't running when
   Claude tries to use it, the tool calls will just fail; start it again
   with `npm run mcp`.

## Notes

- This connects straight to the **production** database — the same one the
  live site and admin dashboard use. Read-only, so there's no risk to the
  data, but the numbers Claude sees are real customer bookings and invoices.
- If you ever add a write-capable tool here, keep it in a clearly separate
  server (or gate it behind an explicit confirmation flow) — don't quietly
  turn this one from read-only into read-write.
