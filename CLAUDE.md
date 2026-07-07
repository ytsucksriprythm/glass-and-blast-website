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
  source: website|manual;
  createdAt, updatedAt: ISO string;
}
```

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
```
**MISSING on Vercel Production:** `GOOGLE_CALENDAR_ICS_URL` — calendar feed won't load live until added to Vercel env vars.

---

## Dev Notes

### No Water-Fed Pole
All copy, services, and FAQ explicitly mention squeegee+mop, pure water, NO water-fed pole or purified-water claims. Non-negotiable.

### Solar Photos
Cropped gray UI bars (phone UI):
- `work-solar-1.jpg` — portrait, 34px gray top cropped
- `work-solar-2.jpg` — landscape (solar-3.png converted), no bars, clean framing

### Images
- `/work-pole-window.jpg` — removed (water-fed pole, against policy)
- `/work-squeegee-hand.jpg` — Ainslie, hand technique
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
