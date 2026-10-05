// Coverage map: every database table and admin section → the MCP tool(s)
// that expose it, plus what's deliberately excluded or simply doesn't exist.
// Returned verbatim by the describe_data_coverage tool, and checked by
// tests/mcp/coverage.test.ts against the real schema (and, via
// scripts/mcp-verify-prod.ts, against production's information_schema) so a
// table or column added later can't silently go unmapped.

export interface TableCoverage {
  tools: string[];
  // Tools return every column of the table (generic row mapping) except these.
  excludedColumns?: Record<string, string>;
  note?: string;
}

export const TABLE_COVERAGE: Record<string, TableCoverage> = {
  bookings: {
    tools: ['search_bookings', 'get_booking', 'get_customer_history', 'list_schedule', 'get_report', 'search_everything'],
    note: 'Customers, leads, quote visits and jobs are all booking rows. All columns returned, including customer notes (notes), private admin notes (adminNotes), flag notes, feedback, timestamps and soft-deleted rows (deleted filter).',
  },
  quotes: { tools: ['list_quotes', 'get_quote', 'get_booking', 'get_customer_history'], note: 'Line items, scope (incl. exclusions), assumptions, payment terms, discounts, totals, validity, public link.' },
  invoices: { tools: ['list_invoices', 'get_invoice', 'list_payments', 'get_booking', 'get_customer_history', 'get_report'], note: 'Line items, bill-to, DVA client block, dates, totals, payment status/method, Square fields, view counts, public link.' },
  invoice_views: { tools: ['get_invoice'], note: 'Per-open view log (IP, device, browser, approximate location, duration) — the admin "View log".' },
  recurring_jobs: { tools: ['list_recurring_plans', 'get_recurring_plan', 'list_schedule', 'get_customer_history'] },
  booking_photos: { tools: ['get_photo_links', 'get_booking'], excludedColumns: { url: 'Raw storage URL replaced by a signed link that expires after 15 minutes.' } },
  booking_groups: { tools: ['get_booking', 'get_business_settings'] },
  activity_log: { tools: ['list_activity', 'get_booking', 'get_quote', 'get_invoice'], note: 'vault.* entries have summary/meta redacted (vault labels can describe secrets).' },
  guests: { tools: ['get_business_settings', 'get_booking', 'get_invoice'], excludedColumns: { password_hash: 'Authentication data — never exposed (not even granted to the read-only role).' } },
  app_settings: { tools: ['get_business_settings'] },
  business_profiles: { tools: ['get_business_settings'] },
  payment_profiles: { tools: ['get_business_settings'], note: 'Business bank details printed on invoices.' },
  dismissed_leads: { tools: ['get_facebook_lead_sync_status'] },
  pageviews: { tools: ['get_report (site_traffic)'], note: 'Aggregated only; visitors are anonymous daily hashes. Individual rows are not listed.' },
  booking_funnel_events: { tools: ['get_report (site_traffic)'], note: 'Aggregated into the booking-form funnel.' },
};

export const EXCLUDED_TABLES: Record<string, string> = {
  vault_items: 'Settings → Vault is a store for secrets (API keys, webhook secrets, etc.). Excluded by design; the read-only role has no access.',
  invoice_counter: 'Internal numbering counter only; invoice numbers themselves are on each invoice.',
  quote_counter: 'Internal numbering counter only; quote numbers themselves are on each quote.',
  mcp_oauth_clients: 'Connector authentication internals.',
  mcp_oauth_codes: 'Connector authentication internals.',
  mcp_oauth_refresh_tokens: 'Connector authentication internals.',
  mcp_audit_log: 'Connector audit trail — kept server-side, not exposed to ChatGPT.',
};

export const ADMIN_SECTIONS: { section: string; tools: string[]; note?: string }[] = [
  { section: 'Dashboard → Overview (totals, status counts, revenue, owed, upcoming jobs/quotes, leads by month)', tools: ['get_report (overview)', 'list_schedule'] },
  { section: 'Dashboard → Bookings & Quotes (Leads / Pipeline lists, filters, inline status/paid/quote)', tools: ['search_bookings', 'get_report (pipeline)'] },
  { section: 'Dashboard → Business stats (conversion, avg quote, revenue by month, suburbs, sources)', tools: ['get_report (business, revenue_by_month)'] },
  { section: 'Dashboard → Site stats (views, pages, referrers, scroll, time, booking-form funnel)', tools: ['get_report (site_traffic)'] },
  { section: 'Booking detail /admin/bookings/[id] (all fields, photos, linked invoices/quotes, feedback, flags)', tools: ['get_booking', 'get_photo_links'] },
  { section: 'Calendar (day/week/month of scheduled jobs + quote visits)', tools: ['list_schedule'] },
  { section: 'Quotes (Quote Maker list + documents)', tools: ['list_quotes', 'get_quote'] },
  { section: 'Invoices (list, detail, view log, Square link, payment)', tools: ['list_invoices', 'get_invoice', 'list_payments'] },
  { section: 'Recurring plans', tools: ['list_recurring_plans', 'get_recurring_plan', 'list_schedule (recurring_projected)'] },
  { section: 'Guests page (subcontractor logins + their assigned jobs/invoices)', tools: ['get_business_settings', 'search_bookings (assignedGuestId)', 'list_invoices (ownerGuestId)'] },
  { section: 'Settings → Invoice & quote autofill (business + payment profiles), address display, Square, notifications, reviews, scheduling, public site, LARP toggles', tools: ['get_business_settings'] },
  { section: 'Settings → Facebook lead sync', tools: ['get_facebook_lead_sync_status'] },
  { section: 'Settings → Deleted bookings (60-day trash)', tools: ['search_bookings (deleted: "only")'] },
  { section: 'Settings → Activity log', tools: ['list_activity'] },
  { section: 'Settings → Export bookings', tools: ['search_bookings (paginate all pages)'] },
  { section: 'Settings → Media library (public ad files)', tools: [], note: 'NOT exposed: files are listed from Vercel Blob storage (not the database) and are public marketing assets, not business records. Can be added on request.' },
  { section: 'Settings → Vault', tools: [], note: 'Excluded by design (secrets).' },
  { section: 'Settings → Guest logins (passwords)', tools: [], note: 'Names/active state exposed; passwords never.' },
  { section: 'LARP (demo) mode data', tools: [], note: 'Fake LARP-* rows are excluded from every tool.' },
];

export const KNOWN_GAPS: { requested: string; status: string }[] = [
  { requested: 'Quote acceptance information', status: 'Not stored. Quotes only have status draft/sent. get_quote infers acceptance from the linked booking status (confirmed/completed = accepted).' },
  { requested: 'Access instructions', status: 'No dedicated field. They live in free-text booking notes / adminNotes and quote assumptions, which are returned in full.' },
  { requested: 'Assigned staff', status: 'Only subcontractor "guest" assignment exists (assignedGuestId/assignedAt). There is no staff roster.' },
  { requested: 'Tax', status: 'Business is not GST-registered: no tax amounts are stored. Invoices have an isTaxInvoice title flag; tools report GST as 0 with the compliance note.' },
  { requested: 'Payment history / amounts paid / balances', status: 'No payments ledger or partial payments. Derived from invoice status/paidAt/paymentMethod/Square fields and booking paid/paidAt/customerMarkedPaidAt (list_payments, get_invoice).' },
  { requested: 'Attachments', status: 'Only booking photos exist (before/after/progress). No other attachment store.' },
  { requested: 'Facebook lead sync run history', status: 'Sync runs are not recorded. Status is derived from imported leads; get_facebook_lead_sync_status checkSheet=true compares the Google Sheet live.' },
  { requested: 'Customer as a record', status: 'No customer table. get_customer_history groups bookings/plans/quotes/invoices by phone, email or exact address.' },
  { requested: 'Google Calendar', status: 'The admin calendar reads bookings.scheduledAt; there is no separate calendar store. (GOOGLE_CALENDAR_ICS_URL is still set in env but no current code reads it.)' },
];

export const DATA_CONVENTIONS = {
  ids: 'Stable record ids: bookings BK-…, quotes QT-… (number Q1000+), invoices INV-… (number GB1044+), recurring plans RJ-…, photos PH-…, activity ACT-…, guests GST-…, groups GRP-…. Use these ids for follow-up calls.',
  nullVsEmpty: 'null = never recorded / not applicable. "" = the field exists and was saved blank. Never treat one as the other.',
  timestamps: 'Timestamps are ISO-8601 UTC as stored. Where local time matters, a Sydney rendering (date, time, weekday, UTC offset, AEST/AEDT) is included under computed.',
  dateFilters: 'Date filters are Australia/Sydney local calendar dates (YYYY-MM-DD), inclusive, with daylight saving handled per date.',
  pagination: 'List tools return total, returned, hasMore and nextCursor. Keep calling with nextCursor (same filters) until hasMore is false to get every record. No list is ever silently truncated.',
  computedFields: 'Anything under `computed` is derived by the connector, not stored in the admin.',
  demoData: 'LARP/demo-mode fake rows are always excluded.',
  readOnly: 'Every tool is read-only. Nothing can be created, changed or deleted through this connector.',
};
