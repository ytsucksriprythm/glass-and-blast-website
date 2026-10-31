# Vapi (Atlas phone assistant) → Glass & Blast MCP

Atlas logs in to the same MCP server ChatGPT and Claude use, but with its own
**machine login** and **narrow permissions**.

## Why a separate login

| | ChatGPT / Claude | Vapi |
|---|---|---|
| OAuth grant | Authorization code + PKCE: you type the connector password on the sign-in page | **Client credentials**: Vapi's "OAuth 2.0" credential posts a client ID + secret to the token URL, with no person signing in |
| Scope | `business.read` (everything, plus writes when `MCP_WRITES_ENABLED=true`) | `bookings.read quotes.read quotes.write` only |
| Token | 1 h access + 30-day rotating refresh | 1 h access, no refresh (Vapi just asks again) |

Vapi can't complete a password sign-in, so the server now also accepts
`grant_type=client_credentials`, but **only** for the one Vapi client defined in
Vercel. ChatGPT and Claude are unaffected.

### What Atlas can and can't do

| Scope | Tools |
|---|---|
| `bookings.read` | `search_bookings`, `get_booking`, `get_customer_history`, `list_schedule` |
| `quotes.read` | `list_quotes`, `get_quote` |
| `quotes.write` | `create_quote`, `update_quote` |

Invoices, payments, reports, settings, the activity log, photos and every other
write (bookings, calendar, invoices, recurring) are **not visible** to Atlas's
token at all. Nothing can be deleted.

Note: `get_booking` and `get_customer_history` also include the booking's
linked quotes and invoice summaries (number, total, paid/unpaid), and bookings
include private `adminNotes`.

### Privacy warning: callers are not you

Atlas answers the phone, so the person talking to it is usually a customer.
The server can't tell *who* is calling (Vapi doesn't pass the caller's number to
MCP tools), so it can't restrict a token to "the caller's own booking". The
server gives Atlas instructions never to read out another customer's details
or private notes, but that's instruction-following, not enforcement.

Put the same rule in Atlas's system prompt. If Atlas only needs to quote and
book, consider dropping `bookings.read` (set `MCP_VAPI_SCOPES=quotes.read quotes.write`).

## Setup

### 1. Generate the Vapi client ID and secret (your PC)
```bash
npx tsx scripts/mcp-setup-secrets.ts --vapi
```
This prints `MCP_VAPI_CLIENT_ID`, `MCP_VAPI_CLIENT_SECRET_HASH`, and the
**Client Secret** for Vapi. Nothing is saved anywhere, so keep the window open
until steps 2 and 3 are done. The secret goes **only** into Vapi; Vercel gets just
its hash.

### 2. Vercel → Project → Settings → Environment Variables (Production, Sensitive)

| Key | Value |
|---|---|
| `MCP_VAPI_CLIENT_ID` | from step 1 |
| `MCP_VAPI_CLIENT_SECRET_HASH` | from step 1 (starts with `sha256:`) |
| `MCP_VAPI_SCOPES` | optional; default `bookings.read quotes.read quotes.write` |

Then **Deployments → ⋯ → Redeploy**.

Check it worked: `https://glassandblast.com.au/.well-known/oauth-authorization-server`
should list `client_credentials` under `grant_types_supported`.

### 3. Vapi → OAuth 2.0 credential
Vapi Dashboard → **Integrations** → **Server Configuration** → **Add Custom
Credential** → authentication type **OAuth 2.0**:

| Field | Value |
|---|---|
| Credential Name | `Glass & Blast MCP` |
| Token URL | `https://glassandblast.com.au/api/oauth/token` |
| Client ID | `MCP_VAPI_CLIENT_ID` value from step 1 |
| Client Secret | Client Secret from step 1 |
| Scope | `bookings.read quotes.read quotes.write`, or leave blank for all allowed |

Save, and note the credential's ID (`cred_…`).

### 4. Vapi → MCP tool
Dashboard → **Tools** → **Create Tool** → **MCP**:
- **Server URL:** `https://glassandblast.com.au/api/mcp`
- Transport: Streamable HTTP (the default)
- **Authorization credential:** pick `Glass & Blast MCP` if the form shows a
  credential selector.

If the MCP tool form has no credential selector, attach it through the API
using your Vapi **private** API key (Dashboard → API Keys). The tool id is in
the tool's page URL:
```bash
curl -X PATCH https://api.vapi.ai/tool/<tool-id> -H "Authorization: Bearer <vapi-private-key>" -H "Content-Type: application/json" -d '{"server":{"url":"https://glassandblast.com.au/api/mcp","credentialId":"<cred-id-from-step-3>"}}'
```
Don't put an `Authorization` header in the tool's own headers: per Vapi's
schema, that overrides the credential.

Then **Assistants → Atlas → Tools** → add the MCP tool → **Publish**.

### 5. SMS: Vapi's own SMS tool, with explicit consent
The Glass & Blast server has no SMS sending. Use Vapi's built-in **SMS** tool
(`type: "sms"`), which sends through a **Twilio** number in Vapi that has SMS
enabled.

To make it send **only after the caller explicitly agrees**, give the SMS tool
a `rejectionPlan` that rejects the call unless the caller's last message is a
clear yes:
```json
{
  "rejectionPlan": {
    "conditions": [{
      "type": "regex",
      "regex": "(?i)\\b(yes|yeah|yep|sure|please do|go ahead|send it|text me)\\b",
      "target": { "position": -1, "role": "user" },
      "negate": true
    }]
  }
}
```
Also tell Atlas, in its system prompt, to always ask "Would you like me to text
you that?" and wait for a yes before using the SMS tool.

### 6. Test
In Vapi, test-call Atlas and ask about an existing quote. Then check the audit
log in the Neon SQL editor:
```sql
SELECT created_at, event, ok, tool FROM mcp_audit_log WHERE event LIKE 'machine_%' OR client_id LIKE 'gbvapi_%' ORDER BY id DESC LIMIT 20;
```
You should see `machine_token_issued`, then `tool_call` rows.

## Controls

| To… | Do |
|---|---|
| Cut Atlas off immediately | Delete `MCP_VAPI_CLIENT_ID` in Vercel and redeploy. Issued tokens stop working too |
| Remove quote writing | Set `MCP_VAPI_SCOPES=bookings.read quotes.read` and redeploy. Takes effect for existing tokens |
| Rotate the secret | Run step 1 again, update the hash in Vercel and the secret in Vapi |
| Revoke every token (ChatGPT, Claude and Vapi) | Bump `MCP_TOKEN_VERSION` |

Wrong-secret attempts are limited to 10 per IP per 15 minutes.
