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

**Transport: stdio, via Settings → Developer → Local MCP servers.** Claude
Desktop has *two* separate places that look like they'd work here, and only
one actually does:

- **Settings → Connectors → "Add custom connector"** — takes a **remote**
  URL only. This is the account-level, cloud-synced connectors framework:
  the URL is validated and called **from Anthropic's own servers** (so your
  connector works from any of your devices), not from the Claude Desktop app
  running on your PC. A `127.0.0.1` URL entered here can never work — from
  Anthropic's datacenter, `127.0.0.1` means *their* server, not yours, so the
  request fails instantly and never even reaches your machine (confirmed by
  running the server with request logging: clicking "Add" produced zero
  network activity — not even a TCP connection attempt).
- **Settings → Developer → Local MCP servers** — this is the classic
  mechanism: Claude Desktop itself spawns your command as a child process and
  talks to it over stdio. Since the app on *your* machine does the spawning,
  it can obviously reach anything on your machine. This is the one to use.

1. **Install dependencies** (once, from the repo root):
   ```
   npm install
   ```
2. **Create `mcp-server/.env`** with the production Neon connection string —
   deliberately a *separate* file from the repo root's `.env.local`, whose
   `DATABASE_URL` is left blank on purpose so a plain `npm run dev` never
   touches production. This connector is the opposite: always production,
   always read-only.
   ```
   DATABASE_URL_UNPOOLED=postgresql://...
   ```
   Get the connection string from **Neon's own console** (console.neon.tech
   → your project → **Connect** → toggle "Connection pooling" **off** to get
   the unpooled/direct string, which is what `db.ts` prefers). Not from
   Vercel — `DATABASE_URL`/`DATABASE_URL_UNPOOLED` are marked **Sensitive**
   in this Vercel project, which makes them permanently unretrievable via
   `vercel env pull` or the dashboard once set that way; Neon is still the
   source of truth and always shows it.
3. **Add it to Claude Desktop's local MCP config.** In the app: Settings →
   Developer → Local MCP servers → **Edit Config**. That opens (or creates)
   `claude_desktop_config.json` — add an entry to `mcpServers` (adjust every
   path if your checkout isn't at `C:\claude\window clean`, and confirm
   `node.exe`'s path with `where node`):
   ```json
   {
     "mcpServers": {
       "glass-and-blast": {
         "command": "C:\\Program Files\\nodejs\\node.exe",
         "args": [
           "-r",
           "C:\\claude\\window clean\\node_modules\\dotenv\\config.js",
           "C:\\claude\\window clean\\node_modules\\tsx\\dist\\cli.mjs",
           "C:\\claude\\window clean\\mcp-server\\index.ts"
         ],
         "cwd": "C:\\claude\\window clean",
         "env": {
           "DOTENV_CONFIG_PATH": "C:\\claude\\window clean\\mcp-server\\.env",
           "DOTENV_CONFIG_QUIET": "true"
         }
       }
     }
   }
   ```
   Why it's not simpler than this (all three were real failures hit while
   building this, in order):
   - **Absolute `node.exe` path, not bare `"node"`.** If Desktop's `env`
     field replaces rather than merges the child's environment, a bare
     `"node"` has no `PATH` to resolve against and fails to spawn at all.
   - **The `-r <absolute path to dotenv/config.js>` preload, plus explicit
     `cwd`.** Without it, whether `.env` loads at all depends on JS
     import/module-hoisting order inside `index.ts`, which isn't reliably
     "the dotenv call runs before `db.ts` reads `process.env`" — it silently
     wasn't, the one time this shipped without the preload. And without
     `cwd`, Desktop spawns this with no working directory set, which
     Windows defaults to `C:\WINDOWS\System32` — harmless on its own, but if
     env loading *also* fails, `db.ts`'s local-JSON-store fallback tries to
     `mkdir` a `data` folder there and crashes with `EPERM`.
   - **`DOTENV_CONFIG_QUIET: "true"`.** dotenv prints an "injected env from
     .env" tip line to **stdout** by default — which for a stdio MCP server
     *is* the JSON-RPC wire. That stray line corrupts the very first
     message and shows up in Claude Desktop as "Unexpected token '◇' ...
     is not valid JSON".
   (Note for this specific install: it's a Microsoft Store / MSIX package,
   so Windows redirects `%APPDATA%\Claude\claude_desktop_config.json` to
   `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
   — the in-app "Edit Config" button handles this correctly; if editing by
   hand, use the redirected path.)
4. **Restart Claude Desktop** (fully quit from the tray, not just close the
   window) so it picks up the new config and spawns the server. It should
   show up under Developer → Local MCP servers with the 10 tools above
   available in chat. No need to run anything manually — the app starts and
   stops the process itself, alongside its own lifecycle.

### Expect the first tool call after a restart to be slow

`db.ts`'s schema-migration check (`ensureSchema()` — a few dozen sequential
`CREATE TABLE`/`ALTER TABLE IF NOT EXISTS` statements) is memoized per
process, not persisted anywhere — so a freshly-spawned MCP server process
pays that cost exactly once. `index.ts` fires it in the background right
after connecting (not blocking the connection itself), and every query has
a couple of automatic retries, so in practice this resolves itself — but the
very first tool call after a Desktop restart can still take 10–20+ seconds
before it settles down; every call after that is well under a second. This
is expected, not a sign anything's broken.

## Notes

- This connects straight to the **production** database — the same one the
  live site and admin dashboard use. Read-only, so there's no risk to the
  data, but the numbers Claude sees are real customer bookings and invoices.
- If you ever add a write-capable tool here, keep it in a clearly separate
  server (or gate it behind an explicit confirmation flow) — don't quietly
  turn this one from read-only into read-write.
