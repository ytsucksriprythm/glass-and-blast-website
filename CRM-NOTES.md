# Window Cleaning CRM Research Notes

Notes on the major CRMs used by window cleaning / pressure washing businesses.
Not a design spec — a reference for what the paid tools do, how their flows work,
and which ideas are worth stealing (patterns, not pixels).

---

## The Big Five (most used in this trade)

| CRM | Price | Sweet spot | Known for |
|-----|-------|-----------|-----------|
| **QuoteIQ** | $30–699/mo | Window/pressure specialists | Built BY window cleaners. AI quoting, satellite property measurement, route optimization |
| **Housecall Pro** | $59–299/mo | Home services, 1–10 techs | Live dispatch map, "on my way" texts, mobile-first field app |
| **Jobber** | $39–599/mo | General field service, best UX | Cleanest interface of the lot, customer portal, big app marketplace |
| **ServiceTitan** | $245+/user/mo | Enterprise, 20+ techs | Deep dispatch board, 70+ integrations, inventory — overkill under 10 techs |
| **Markate** | mid-market | Window cleaning all types | Residential + commercial + high-rise + storefront workflows |

Also seen: FieldPulse (modern, automation-heavy), ZenMaid ($19/mo, cleaning-specific),
ServiceM8 ($29/mo flat, unlimited users, offline-first), Launch27, Service Fusion, Moxie (SMS-first).

---

## The Universal Workflow

Every single one of them runs the same pipeline:

```
Lead → Estimate/Quote → Approval → Scheduled Job → Work done → Invoice → Payment → (Repeat/Recurring)
```

Differences are only in how much of each step is automated and how it feels on a phone.

---

## How Their Interfaces Work

### Dashboard (first screen after login)
- **Stat cards on top**: today's jobs, revenue this month, pending leads, unpaid invoices
- **"Needs action" lists**: overdue estimates, unpaid completed jobs, unconfirmed bookings
- **Today's schedule** front and centre — the field guy's day at a glance
- Housecall Pro/ServiceTitan add a **live map** with technician dots

### Navigation
- Desktop: left sidebar (Customers / Jobs / Schedule / Invoices / Reports / Settings)
- Mobile: bottom tab bar, 4–5 tabs max
- Jobber does top-nav; everyone else sidebar + bottom-tabs

### Job creation flow (office side)
1. Search/create customer (phone number lookup auto-fills returning customers)
2. Pick service(s) from a priced catalog (line items with saved prices)
3. Pick date/time on calendar — some suggest slot based on route proximity
4. Assign tech → tech gets push notification
5. Optional: send estimate first; customer approval auto-converts to job

### Scheduling screens
- **Calendar grid** (day/week/month) with one colour per tech
- **Drag-and-drop** to reschedule or reassign — the core interaction everywhere
- **Gantt-style tech lanes** (FieldPulse) for capacity view
- **Map view** (Housecall Pro) — jobs as pins, drag pin onto tech
- Recurring jobs render as auto-repeating calendar entries

### Customer profile page
- One page per customer: contact info, every past job, every quote, every payment
- Notes fields split **customer-visible vs internal** (gate codes, dog warnings, "difficult about price")
- Tags: VIP, referral source, plan customer
- Lifetime value figure shown on profile
- Multi-property support for landlords/commercial

### Field tech mobile app (they ALL have one)
- Today's job list, ordered by route
- Tap job → customer details, notes, navigate button (opens Maps)
- **Before/after photo capture** — standard everywhere, camera opens in-app
- Status buttons: On my way → Arrived → Started → Done (each can text the customer)
- Signature capture on completion
- Take payment on-site (card reader or payment link)
- Offline mode (ServiceM8 best at this) — job list cached, syncs when signal returns

---

## Feature Catalog (standard vs premium)

### Scheduling & Dispatch
- Standard: drag-drop calendar, colour coding, manual assign, day/week/month views
- Premium: **route optimization** (order jobs to minimise driving), live GPS tracking, auto-dispatch nearest tech, traffic-aware routing

### Customer Management
- Standard: contact DB, job history, notes, search
- Premium: segmentation/filtering, lifetime value, churn flags, satellite/Street View of property, custom fields

### Online Booking
- Standard: booking form embedded in website, email confirmation
- Premium: real-time slot availability, instant confirmation, self-serve reschedule, custom intake questions, per-service pricing shown live

### Quoting & Invoicing
- Standard: quote → invoice conversion, templates, payment reminders, tax handling
- Premium: options/good-better-best quotes (upsell screens, gutters etc.), auto-charge card on file, payment plans, late-fee automation

### Payments
- Standard: card + bank transfer via Stripe-type processor, pay-online links
- Premium: on-site tap-to-pay readers, same-day settlement, card-on-file recurring billing

### Recurring Jobs (THE money feature for window cleaning)
- Universal: set frequency (weekly/monthly/quarterly), system auto-creates the next job
- Premium: plan discounts, auto-invoice + auto-charge each cycle, "your clean is coming up" customer notices

### Reporting
- Standard: revenue by month, jobs completed, service mix
- Premium: quote→job conversion rate, average job value, revenue by suburb, tech performance (jobs/day, ratings), lead source tracking, CAC, forecast

### Team Management
- Standard: multiple logins, roles (admin vs tech), assign jobs
- Premium: GPS clock-in/out, payroll export, commission tracking, per-tech ratings, workload balancing

### Communication
- Standard: email confirmations and reminders
- Premium: **two-way SMS**, "on my way" texts with ETA, automated review requests after job (Google review link), customer portal, 24/7 AI phone answering (QuoteIQ Elite)

### Integrations
- Standard: Google Calendar, QuickBooks/Xero, Zapier
- Premium: open API, Mailchimp, CompanyCam, custom CRM sync

---

## UX Patterns Worth Noting (not copying)

1. **Phone number is the primary key** — type a number, existing customer pops up with full history
2. **One-tap actions from lists** — call, text, navigate straight from the job card, no drilling in
3. **Status is always a big coloured chip** — pending amber, confirmed blue, done green; whole industry converged on this
4. **The money screens lead** — "unpaid" and "uncontacted leads" get dedicated panels, not buried in reports
5. **Camera-first on mobile** — photo buttons open camera directly, not a file picker
6. **Estimates are sales tools** — sent as branded links the customer approves with one tap; approval auto-schedules
7. **Everything texts the customer** — booked, reminder day before, tech on the way, job done + review ask
8. **Recurring = retention engine** — every CRM pushes converting one-offs onto plans, because that's the LTV
9. **Desktop dense, mobile minimal** — same data, PC gets tables + charts, phone gets cards + one action per screen

---

## Pricing Tier Pattern

| Tier | $/mo | What unlocks |
|------|------|--------------|
| Solo | $19–50 | Core: schedule, invoice, customer DB |
| Growth (3–10 techs) | $75–150 | SMS, GPS, automations, portal |
| Scale (10+) | $200–500 | Route opt, advanced reports, API |
| Enterprise | $500+/custom | Multi-location, inventory, compliance |

Route optimization, SMS, and advanced reports are the consistent paywall features.

---

## What Glass & Blast Already Has vs The Paid Tools

| Feature | Paid CRMs | Ours |
|---------|-----------|------|
| Booking intake | ✔ | ✔ single-screen form |
| Customer records + history | ✔ | ✔ bookings DB |
| Status pipeline | ✔ | ✔ pending→quoted→confirmed→completed |
| Quote + paid tracking | ✔ | ✔, plus a "customer says paid" claim flag separate from confirmed paid |
| Calendar | ✔ built-in | ✔ built-in (bookings own their own `scheduledAt` slot; no external feed) |
| Before/after photos | ✔ | ✔ built (camera roll or camera, not camera-only) |
| Recurring plans | ✔ | ✔ built (auto-create + cron, schedules straight onto the calendar) |
| Revenue/lead reports | ✔ | ✔ business + site stats, plus a lead-source (how-we-got-the-job) chart |
| Push notifications | ✔ | ✔ ntfy |
| Leads-to-call / owed panels | ✔ | ✔ built |
| Bulk actions | ✔ | ✔ multi-select → status change / delete |
| Job grouping / batching | some | ✔ built — grouped jobs collapse to one row (title/count/total), inline in the list |
| Post-job review request | ✔ premium | ✔ built — thank-you page after "I've paid", 4–5★ redirects to the Google review link |
| Invoice ↔ job linking | ✔ | ✔ multi-booking link, address-matched suggestions, payment sync |
| SMS automation | ✔ premium | ✘ skipped (not free in AU) |
| Route optimization | ✔ premium | ✘ future (Phase 2) |
| Tech field app | ✔ | ✘ future (admin PWA covers 2–3 person team) |
| On-site card payment | ✔ | ✘ using Square separately |
| Customer portal | ✔ | partial — no account/login, but a per-booking thank-you page (invoice, photos, feedback) |
