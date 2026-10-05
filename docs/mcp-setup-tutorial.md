# Tutorial: connect ChatGPT to Glass & Blast

About 15 minutes. You'll do five things:
1. Make the secrets.
2. Create a read-only database login.
3. Paste five settings into Vercel.
4. Redeploy.
5. Connect ChatGPT.

The connector code is already deployed, but it stays **switched off** (every request gets "not enabled") until step 3 is done. Nothing is exposed in the meantime.

You'll need:
- this repo open on your PC;
- logins for **Neon** (console.neon.tech), **Vercel** and **ChatGPT** (a paid plan: Plus, Pro, Business…).

---

## Step 1: Make your secrets (2 min)

1. Open a terminal in the project folder (`C:\claude\window clean`) and run:

   ```bash
   npx tsx scripts/mcp-setup-secrets.ts
   ```

   It prints four things. They exist only on your screen, so **keep the window open** until you've finished step 3.

   | Printed item | Where it goes |
   |---|---|
   | **Connector sign-in password** (e.g. `abcde-fghjk-…`) | Save it in your password manager. You type it when ChatGPT connects. |
   | `MCP_OWNER_PASSWORD_HASH=scrypt:…` | Vercel (step 3) |
   | `MCP_TOKEN_SECRET=…` | Vercel (step 3) |
   | **Database role password** | Neon (step 2) |

2. Once you've used them, close the window or clear the screen.

## Step 2: Create the read-only database login (4 min)

1. Go to **console.neon.tech**, open the Glass & Blast project, and click **SQL Editor** in the left menu. Make sure the database dropdown says `neondb`.
2. Open `scripts/mcp-readonly-role.sql` from this repo and copy the whole file into the editor.
3. On the first line, replace `REPLACE_WITH_GENERATED_PASSWORD` with the **database role password** from step 1. Keep the quotes around it.
4. Click **Run**.
5. Check the result row at the bottom: **every column must say `true`**. If one says `false`, stop and ask Claude before going further.

> ⚠️ Don't create this login from Neon's **Roles** page. Logins made there get full read-*write* access. The SQL script is what makes it read-only.

### Build the connection string
1. In Neon, click **Connect** (top of the dashboard).
2. Turn **Connection pooling OFF** and copy the string. It looks like:
   ```
   postgresql://neondb_owner:XXXX@ep-something-123456.ap-southeast-2.aws.neon.tech/neondb?sslmode=require
   ```
3. Swap the user and password for the new login:
   ```
   postgresql://mcp_readonly:<database role password>@ep-something-123456.ap-southeast-2.aws.neon.tech/neondb?sslmode=require
   ```

That's your `MCP_DATABASE_URL`.

## Step 3: Add five settings to Vercel (4 min)

1. In Vercel, open the **glass-and-blast-website** project, then **Settings → Environment Variables**.
2. Add each of these with Environment set to **Production** only and **Sensitive** ticked:

   | Key | Value |
   |---|---|
   | `MCP_ENABLED` | `true` |
   | `MCP_BASE_URL` | `https://glassandblast.com.au` |
   | `MCP_TOKEN_SECRET` | from step 1 |
   | `MCP_OWNER_PASSWORD_HASH` | from step 1 (starts with `scrypt:`) |
   | `MCP_DATABASE_URL` | from step 2 |

## Step 4: Redeploy and check it's alive (2 min)

1. In Vercel, go to **Deployments**, click **⋯** on the latest one, then **Redeploy**. New settings only apply after a redeploy.
2. When it's done, open this in your browser:

   **https://glassandblast.com.au/.well-known/oauth-protected-resource/api/mcp**

   You should see a short block of text containing `"resource":"https://glassandblast.com.au/api/mcp"`.
   - If it says *"This connector is not enabled"*, one of the five settings is missing or mistyped. Check them and redeploy.

## Step 5: Connect ChatGPT (3 min)

1. In ChatGPT on the web, go to **Settings → Security and login** and turn on **Developer mode**. On some accounts it's under **Settings → Apps & Connectors → Advanced settings**.
2. Go to **Settings → Apps & Connectors** (newer versions call it **Plugins**) and click **Create** (or **+**). Fill in:
   - **Name:** `Glass & Blast`
   - **Description:** `Read-only access to my customers, bookings, quotes, invoices and reports`
   - **MCP server URL:** `https://glassandblast.com.au/api/mcp`
   - **Authentication:** OAuth. Leave the client ID and secret blank.
3. Click **Create**. A **Glass & Blast sign-in page** opens.
   - Check it says the request is from `chatgpt.com`.
   - Enter your connector password from step 1.
   - Tap **Allow read-only access**.
4. ChatGPT should now list 18 tools.
5. Start a **new chat**, open the tools menu (**+** in the message box), and switch on **Glass & Blast**.

### Try it
- "What jobs and quote visits do I have tomorrow? Include the access notes."
- "Which customers have I quoted who haven't booked yet? Oldest first."
- "Show every Facebook lead from the last 14 days that's still uncontacted."
- "What's owed to me right now?"

---

## Handy controls

| I want to… | Do this |
|---|---|
| Disconnect ChatGPT | ChatGPT → Settings → Apps & Connectors → Glass & Blast → Disconnect/Delete |
| Log out every connection instantly | Vercel: add `MCP_TOKEN_VERSION` = `2` (then 3, 4… next time), redeploy |
| Switch the whole thing off | Vercel: set `MCP_ENABLED` = `false`, redeploy |
| Change my connector password | Run `npx tsx scripts/mcp-setup-secrets.ts` again, replace `MCP_OWNER_PASSWORD_HASH` in Vercel, redeploy |
| See who used it | Neon SQL Editor: `SELECT created_at, event, ok, tool, result_count FROM mcp_audit_log ORDER BY id DESC LIMIT 50;` |
| Pick up tool updates | ChatGPT → the connection → **Refresh**, then start a new chat |

## Troubleshooting

- **"This connector is not enabled".** A Vercel setting is missing or wrong, or you didn't redeploy after adding them.
- **"Incorrect password".** Use the *connector* password from step 1, not your admin password. After 5 wrong tries, wait 15 minutes.
- **Tools error with "temporarily unavailable (database safety check failed)".** The database login has more access than it should, or `MCP_DATABASE_URL` points at the wrong user. Recheck step 2 (all `true`) and that the URL starts with `postgresql://mcp_readonly:`.
- **ChatGPT says it can't connect.** Make sure the URL ends in `/api/mcp` and starts with `https://`, and that the step 4 check works.

More detail (architecture, coverage checklist, limitations): [mcp-chatgpt.md](mcp-chatgpt.md).
