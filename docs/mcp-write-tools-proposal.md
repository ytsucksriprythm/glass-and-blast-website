# Proposed MCP write tools: NOT ENABLED

**Status:** design only, for your review. No code exists for these tools, none are registered, and the deployed connector can't write anything:
- its database role has no write grants, and every query runs in a `READ ONLY` transaction;
- the server refuses to start serving if its role can write.

Enabling writes means deliberately adding a second, separate path, which is designed below. This document only proposes it.

## Ground rules (all four tools)

1. **Separate everything.**
   - Separate OAuth scope `business.write`, requested only when you choose to enable writes, and shown separately on the consent page.
   - Separate DB role `mcp_writer` with column-level `UPDATE`/`INSERT` on exactly the columns each tool touches. No `DELETE`, ever.
   - Separate kill switch `MCP_WRITES_ENABLED`, off by default.
2. **Unique IDs only.** Every tool takes a record id (`BK-…`), never a name.
   - If ChatGPT only has a name, it must first call `search_everything` or `search_bookings`.
   - If several people match, it must show the candidates (name, suburb, phone, id) and ask you which one.
   - The server rejects a call without a valid id.
3. **Preview, then confirm.**
   - Each tool runs in two steps: `mode: "preview"` returns the exact before/after diff plus a single-use `confirmToken` (HMAC over record id, diff and `updatedAt`, valid 5 minutes).
   - `mode: "apply"` requires that token.
   - If the record changed since the preview (`updatedAt` moved), apply is refused, which prevents lost updates.
   - The tools are annotated `destructiveHint: true` / `readOnlyHint: false`, so ChatGPT asks for your confirmation before every apply.
4. **Return the saved result.** Apply re-reads the row after commit and returns it, plus the activity-log entry id, so you can verify what was written.
5. **Same side effects as the admin.** Changes go through the same functions the admin uses (`updateBooking`, `logActivity`, `syncBookingStatusToSheet`, notifications), so the activity log, Google Sheet "Site Status" column and push notifications all stay consistent. The actor is recorded as `chatgpt`.
6. **Audit.** Every preview and apply is written to `mcp_audit_log` with the diff field names (not values).

## 1. `refresh_facebook_leads`
- **Does:** runs the same import as `/api/cron/meta-leads-sheet` on demand.
- **Duplicate prevention:** already built in and reused: the unique index on `bookings.external_lead_id`, the `dismissed_leads` check, and a skip when a row was already imported.
- **Input:** none (or `dryRun: true`, which reuses `checkLeadSheet` to list what would be imported).
- **Returns:** the ids and names of imported bookings, plus counts checked/skipped.
- **Risk:** low. Writes only new `facebook-lead-ad` bookings and fires the usual owner notifications. It could even be enabled without the preview step.

## 2. `append_customer_note`
- **Input:** `bookingId`, `note` (1–2000 chars), `target: "admin_notes" | "notes"` (default `admin_notes` = private).
- **Behaviour:**
  - Appends `\n\n[2026-10-05 14:32 AEDT · via ChatGPT] <note>` to the existing text in a single `UPDATE … SET admin_notes = admin_notes || $note`.
  - Existing text is never replaced or reordered.
  - Writing to the customer-visible `notes` field needs explicit `target: "notes"`.
- **Returns:** the full saved notes field and the new `updatedAt`.

## 3. `update_customer_details`
- **Input:** `bookingId`, plus any of `name, phone, email, address, suburb, propertyType, status, quoteAmount, paid, paidAt, completedAt, leadSource`, plus `expectedUpdatedAt`.
- **Rules:**
  - Validates exactly like the admin PATCH route: allowed statuses, the phone `p:` prefix stripped, and auto-stamping `contactedAt`/`completedAt`/`quotedAt` on status change.
  - `adminNotes` can't be overwritten here (use `append_customer_note`).
  - Delete and soft-delete are not offered.
- **Preview** shows the field-by-field before/after. **Apply** returns the saved booking.

## 4. `schedule_visit` / `reschedule_visit`
- **Input:**
  - `bookingId`
  - `start` (Sydney local `YYYY-MM-DDTHH:MM`)
  - `durationMinutes` (default 60)
  - `visitType: "quote_visit" | "job"`, which sets status `quote-booked` or `confirmed` exactly like the admin calendar
  - `expectedUpdatedAt`
- **Conflict check:** finds any non-cancelled booking whose `[scheduledAt, scheduledEnd)` overlaps the new slot (with a configurable buffer, default 30 min travel). Overlaps are returned in the preview, and apply is refused while conflicts exist unless you pass `allowOverlap: true` explicitly.
- **Times:** Sydney local input, converted with the tz database, so a slot at 02:30 on the DST-start day is rejected as non-existent.
- **Returns:** the saved booking with its Sydney-time slot.

## What you'd need to approve
- Which of the four tools to build (suggested order: 1, 2, then 3 and 4).
- Whether customer-visible `notes` may ever be written, or only private `admin_notes`.
- The `mcp_writer` role grants (a SQL script would be provided, in the same style as `scripts/mcp-readonly-role.sql`).
