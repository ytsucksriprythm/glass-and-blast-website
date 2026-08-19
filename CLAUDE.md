# Glass & Blast Window Cleaning — Project Context

## Project
Next.js 16 website + admin PWA for Glass & Blast (North Canberra window + pressure washing).

**Repo:** `C:\claude\window clean` (public, no secrets in source)  
**Live:** https://glassandblast.com.au | **Admin:** /admin (PWA-installable on iPhone)  
**Tech:** Next.js 16 App Router, TypeScript, Tailwind v3, Framer Motion, Lucide React, Neon Postgres (prod) / local JSON (dev)

---

## Current State (as of commit c4abf5a)

### Public Site (Light Theme)
- **Hero:** dark video background, light text, logo, nav, CTA buttons
- **Sections:** hero → services (3 cards: window, pressure, solar) → booking form → areas (ACT coverage) → work gallery (3 shots) → reviews → footer
- **Services:** named "Spot-Free Finish" (squeegee+mop, NO water-fed pole; solar with pure water)
- **Booking form:** name/phone/email/suburb/address/preferred date+time/notes; creates records in Neon or JSON
- **Areas:** "whole of ACT, travel fee case-by-case"
- **Work gallery:** 3 shots (pole-window O'Connor, squeegee Ainslie, **solar-3.png → work-solar-2.jpg** landscape crop Ainslie)
- **Reviews:** 5 real testimonials, Lincoln Larson mentioned only in one review (NOT in business copy)
- **FAQ, Blog, Privacy, Terms** pages
- **Tracking:** PageTracker (local JSON daily hash of visitor + path, no raw IPs)

### Admin (Dark Navy Theme, PWA-Installable)
- **Auth:** 60-day session cookie + iCloud Keychain autofill (no WebAuthn; password = `glass26` in .env.local)
- **Dashboard:** overview (stats, monthly chart, service pie), bookings table (mobile cards / desktop grid), business stats (conversion, avg quote, revenue by month, top suburbs), site stats (views last 14d, top pages, referrers)
- **Upcoming jobs:** read-only Google Calendar feed (secret iCal URL in .env.local) — jobs hide once slot ends OR matched booking marked completed
- **Bookings:** list + inline status/paid/quote edit; detail page `/admin/bookings/[id]` with edit mode; shows matched Google Calendar slot (date+time) if found; completedAt field (auto-stamped on completed, editable as YYYY-MM-DD)
- **Add-to-calendar:** pre-filled Google Calendar template (title = "address - name", no dates)
- **Mobile:** bottom nav tabs, safe-area padding, skeleton loaders, no white bar at top (`:has()` scope keeps admin dark)

### Data Model (Bookings)
```typescript
interface Booking {
  id: string;  // BK-timestamp
  name, phone, email, suburb, address: string;
  service: comma-separated string (window-washing|pressure-washing|flyscreen-repair|solar-panel-cleaning|other|both);
  propertyType: residential|commercial;
  preferredDate, preferredTime: string;
  notes: string;  // customer-facing
  status: pending|quoted|confirmed|completed|cancelled;
  quoteAmount: number | null;
  adminNotes: string;  // private
  paid: boolean;
  completedAt: ISO string | null;  // auto-stamped on status→completed
  source: website|manual|facebook-lead-ad;
  externalLeadId: string | null;  // Meta lead id (or a row-content hash), dedupes repeated sheet polls (facebook-lead-ad only)
  createdAt, updatedAt: ISO string;
}
```

### Meta (Facebook/Instagram) Lead Ads → Bookings
Instant/Quick Form leads never touch the website (no page visit, so UTM attribution can't catch them). Rather than a direct Meta Graph API webhook (needs a Facebook Developer App + App Review), leads flow through Meta's built-in **Lead Ads → Google Sheets** CRM connector (Ads Manager → Instant Forms → Connect CRM → Google Sheets) — no Meta App Review needed at all, at the cost of polling instead of instant delivery.
- **Flow:** customer submits a Lead Ad form → Meta appends a row to the connected Google Sheet → `/api/cron/meta-leads-sheet` (Vercel Cron, see `vercel.json`) reads every tab in the sheet via a Google service account → any row not already imported becomes a `Booking` (`source: 'facebook-lead-ad'`, `status: 'pending'`)
- **Multiple forms:** Meta writes one tab per connected lead form (trialing several forms = several tabs). Tabs are discovered live via `listSheetTabs()` — no config needed when a new form/tab is added
- **Auth to Google:** `src/lib/googleSheets.ts` — hand-rolled service-account JWT → OAuth token exchange → Sheets API v4 read/write, no `googleapis` dependency. **The Sheet must be shared with the service account as Editor** (not just Viewer) — the status write-back below needs write access
- **Field mapping:** `src/lib/metaLeads.ts` matches each tab's header row by normalized (alphanumeric-only) name (`full_name`/`name`, `email`, `phone_number`/`phone`, `address`/`street_address`/a combined column like `property_address_/_suburb`, `city`/`suburb`, `id`) plus a service keyword match (window/pressure/solar/flyscreen); anything unmatched (custom form questions) is preserved verbatim in `notes` so nothing is lost
- **Dedup:** `externalLeadId` has a partial unique index — re-running the poll over rows already imported is a no-op. Falls back to a hash of the row if the sheet has no `id` column (and status write-back is skipped for those, since there's no reliable way to relocate the row)
- **Status write-back (site → Sheet, one-way only):** changing a booking's status in admin writes it into a "Site Status" column in the sheet (`syncBookingStatusToSheet()` in `metaLeads.ts`, triggered from the booking PATCH route) — reference only. This does **not** reach Meta's own `lead_status` column or its ad-delivery optimization; Meta's Connect-CRM → Sheets export is one-way (Meta → Sheet). Real bidirectional sync would need Meta's separate Conversions API for Lead Ads
- **Notifications:** owner email/push fire as normal; the customer "Booking Confirmed" email is skipped for this source (a lead isn't a confirmed date/time yet)
- **Admin UI:** blue "FB Lead" badge (bookings list, manage modal), "Facebook lead ad" (detail page, Business Stats → Leads by Source), manual "Sync now" button in Settings → Facebook lead sync
- **Schedule:** Vercel Cron currently runs it once/day (`vercel.json`, `0 22 * * *`) — matches the free Hobby plan's cron frequency limit. For faster turnaround, ping `https://glassandblast.com.au/api/cron/meta-leads-sheet?secret=$CRON_SECRET` from a free external scheduler (e.g. cron-job.org) every few minutes instead — the route already accepts the secret either way (header or query param)
- **Required env vars (not yet set anywhere):** `GOOGLE_SERVICE_ACCOUNT_JSON` (full service-account key JSON, one line), `META_LEADS_SHEET_ID`, optionally `META_LEADS_SHEET_RANGE` (default `A:Z`, applied to every tab) — `CRON_SECRET` already exists (shared with `/api/cron/recurring`). See Next Steps for the Meta/Google-side setup this needs before it goes live

### Calendar (Google Calendar iCal Feed)
- **Flow:** Secret iCal URL → fetched server-side via `/api/admin/calendar` → parsed by `src/lib/calendar.ts`
- **Parsing:** VEVENT records extracted; DTSTART (UTC→Sydney TZ conversion via Intl); DTEND parsed for slot end time
- **Filtering:** jobs filtered `endKey > now` (no old 18h cushion); shown up to 8 upcoming
- **Matching:** event title parsed "address - name" format; matched to booking by name or address substring
- **Cache:** 60s in-memory; invalidates automatically

### Light-Theme Switch
- `body { background: #fff; color: #0f172a; }`
- Admin pinned dark via `admin-shell` marker class + `:has()` CSS rule
- Form inputs stay dark in admin via `.light-form` scoped override
- **Admin mobile fix:** `html:has(.admin-shell), body:has(.admin-shell) { background: #060D1A; }` kills white bar in status-bar area

### Scroll Centering
- `smoothScrollTo(href)` helper dynamically measures navbar height (64px mobile / 80px desktop)
- **Fits viewport:** section centered
- **Taller than viewport:** heading anchored to ~30% down (upper-third), avoids jammed-under-navbar on mobile

---

## Key Files & Patterns

### Public Site
- `src/app/page.tsx` — hero, services, booking form, gallery, reviews, scroll helpers
- `src/app/layout.tsx` — root metadata, structured data (LocalBusiness + reviews)
- `src/lib/areas.ts`, `src/app/areas/[slug]/page.tsx` — local SEO area pages
- `src/lib/blog.ts` — blog posts (how-to, DIY vs pro, cost guides)
- `src/lib/services.ts`, `src/lib/faq.ts` — service/FAQ content
- `src/lib/reviews.ts` — 5-star testimonials
- `src/app/globals.css` — light body bg, admin `:has()` rule, scrollbar, shimmer animation

### Admin
- `src/app/admin/layout.tsx` — PWA metadata, `admin-shell` marker, dark theme
- `src/app/admin/dashboard/page.tsx` — stats, tabs, upcoming jobs, modals for add/manage bookings
- `src/app/admin/bookings/[id]/page.tsx` — detail view + edit mode; shows calendar slot + completion date
- `src/app/api/admin/login/route.ts` — POST password → session cookie; DELETE to logout
- `src/app/api/admin/calendar/route.ts` — GET upcoming jobs (force-dynamic, auth-gated)
- `src/app/api/admin/bookings/route.ts`, `[id]/route.ts` — CRUD + stats endpoints

### Libraries
- `src/lib/auth.ts` — HMAC session token, fail-closed, no hardcoded secrets
- `src/lib/calendar.ts` — ICS parser, DTSTART/DTEND, UTC→Sydney TZ, Job type with endKey
- `src/lib/db.ts` — dual storage (Neon SQL + local JSON), rowToBooking mapper, schema init, stats queries
- `src/components/PageTracker.tsx` — daily visitor hash tracking

---

## Secrets (in .env.local, gitignored)
```
ADMIN_PASSWORD=glass26
ADMIN_SECRET=glass-blast-admin-secret-2025
GOOGLE_CALENDAR_ICS_URL=https://calendar.google.com/calendar/ical/[...]/basic.ics
NTFY_TOPIC=...
DATABASE_URL=... (Vercel Neon integration sets this)
CRON_SECRET=... (shared by all Vercel Cron routes — recurring jobs + Meta leads sheet sync)
GOOGLE_SERVICE_ACCOUNT_JSON=... (full service-account key JSON, one line — Meta leads sheet sync)
META_LEADS_SHEET_ID=... (from the Google Sheet's URL — Meta leads sheet sync)
```
**MISSING on Vercel Production:** `GOOGLE_CALENDAR_ICS_URL` — calendar feed won't load live until added to Vercel env vars. `GOOGLE_SERVICE_ACCOUNT_JSON` / `META_LEADS_SHEET_ID` aren't set up anywhere yet — see Next Steps.

---

## Dev Notes

### No Water-Fed Pole
All copy, services, and FAQ explicitly mention squeegee+mop, pure water, NO water-fed pole or purified-water claims. Non-negotiable.

### Solar Photos
Cropped gray UI bars (phone UI):
- `work-solar-1.jpg` — portrait, 34px gray top cropped
- `work-solar-2.jpg` — landscape (solar-3.png converted), no bars, clean framing

### Images
- `/work-pole-window.jpg` — O'Connor, extension pole WITH SQUEEGEE head (owner confirmed real technique, NOT water-fed — do not remove again). In gallery.
- `/work-window-pole.jpg` — hero video poster (same squeegee-on-pole technique)
- `/work-squeegee-hand.jpg` — Ainslie, hand technique
- `/work-pressure-wash.jpg` — driveway pressure wash, in gallery
- `/work-solar-2.jpg` — Ainslie, landscape
- `/before-sliding-door.jpg`, `/after-sliding-door.jpg` — before/after slider
- Solar service card uses `/work-solar-1.jpg` (portrait)
- All images via Next `<Image>`, optimized at build

### Scroll Targets
- `#hero` — top
- `#services` — 3 service cards
- `#book` — booking form (tall on mobile, centered upper-third)
- `#areas` — area cards (fits viewport, centered)
- `#work` — gallery
- `#reviews` — testimonials

### Admin PWA
- Nested layout at `/admin`; manifest + apple-touch-icon (jimp-composited navy)
- Safe-area padding (status bar, home indicator)
- Bottom nav (mobile only), sticky header
- Installable on iPhone → stands alone, no browser UI
- Dark navy theme throughout

### Testing
- `tsc --noEmit` — no errors
- Preview server runs on 3000
- Admin login: `glass26`
- Calendar parser tested with synthetic ICS feed (past/ongoing/future/no-end events)

### Build & Deploy
- Vercel: 26 routes, build clean
- Postgres pooled vs unpooled: prefer unpooled (`DATABASE_URL_UNPOOLED`)
- No secrets committed; `.env.local`, `TRANSFER.md`, `/data`, `"photo and video recources"` all gitignored
- Last commit: `c4abf5a` (calendar filtering, booking completion tracking, mobile UX fixes)

---

## Next Steps
1. Add `GOOGLE_CALENDAR_ICS_URL` to Vercel Production environment variables
2. Monitor calendar feed latency (should update within 60s of Google Calendar change)
3. Test booking-to-calendar matching on live data (event titles must contain name or address)
4. Consider: automated SMS/email on booking state changes (optional future)
5. **Meta Lead Ads → Google Sheets → Bookings — code is done, needs setup on the Meta/Google side:**
   - In Ads Manager: Instant Forms → your lead form → **Connect CRM** → **Google Sheets**, authorize, let it create the destination sheet. Naming form questions "Street Address"/"City" (not just "Address") gets them auto-mapped into the booking's address/suburb fields
   - In Google Cloud Console: new project (or reuse one) → enable the **Google Sheets API** → create a **Service Account** → generate a JSON key
   - Copy the **service account's email** and share the Sheet with it as **Editor** (Sheet → Share) — Viewer isn't enough, the status write-back needs write access
   - Set `GOOGLE_SERVICE_ACCOUNT_JSON` (the full key JSON, as one line) and `META_LEADS_SHEET_ID` (from the Sheet's URL) in `.env.local` and Vercel Production env vars — `CRON_SECRET` should already be set (shared with the recurring-jobs cron)
   - Send a test lead (Ads Manager → Lead form library → Preview → test submission), confirm the row lands in the Sheet, then hit Settings → Facebook lead sync → **Sync now** in `/admin/settings` and confirm a booking with the blue "FB Lead" badge appears in `/admin/dashboard`
   - Once confirmed working, decide on cadence: leave the once/day Vercel Cron (`vercel.json`), or point a free external scheduler (cron-job.org) at `/api/cron/meta-leads-sheet?secret=$CRON_SECRET` every few minutes for faster pickup
