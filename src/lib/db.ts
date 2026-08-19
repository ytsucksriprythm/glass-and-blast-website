import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import {
  type Invoice, type InvoiceInput, type InvoiceLineItem, type InvoiceStatus,
  type PaymentProfile, type BusinessProfile, INVOICE_PREFIX, INVOICE_START_SEQ,
  SEED_PAYMENT_PROFILES, SEED_BUSINESS_PROFILES, computeTotals, isInvoiceOverdue, debtorDays,
} from './invoice';
import { type AppSettings, DEFAULT_SETTINGS } from './settings';
import { type ActivityEntry, type InvoiceViewSession } from './activity';

const DB_PATH = path.join(process.cwd(), 'data', 'bookings.json');
const PV_PATH = path.join(process.cwd(), 'data', 'pageviews.json');
const PHOTO_PATH = path.join(process.cwd(), 'data', 'photos.json');
const RECURRING_PATH = path.join(process.cwd(), 'data', 'recurring.json');
const INVOICE_PATH = path.join(process.cwd(), 'data', 'invoices.json');
const PAYMENT_PROFILE_PATH = path.join(process.cwd(), 'data', 'payment-profiles.json');
const BUSINESS_PROFILE_PATH = path.join(process.cwd(), 'data', 'business-profiles.json');
const GUEST_PATH = path.join(process.cwd(), 'data', 'guests.json');
const GROUP_PATH = path.join(process.cwd(), 'data', 'booking-groups.json');
const SETTINGS_PATH = path.join(process.cwd(), 'data', 'settings.json');
const ACTIVITY_PATH = path.join(process.cwd(), 'data', 'activity-log.json');
const INVOICE_VIEWS_PATH = path.join(process.cwd(), 'data', 'invoice-views.json');
const ACTIVITY_MAX_ROWS = 2000; // local JSON store only — Neon has no cap

export type BookingStatus = 'pending' | 'quoted' | 'confirmed' | 'completed' | 'cancelled' | 'cold';
export type ServiceType = 'window-washing' | 'pressure-washing' | 'both' | 'flyscreen-repair' | 'solar-panel-cleaning' | 'other';
export type PropertyType = 'residential' | 'commercial';
export type BookingSource = 'website' | 'manual';

export interface Booking {
  id: string;
  name: string;
  email: string;
  phone: string;
  service: ServiceType;
  propertyType: PropertyType;
  address: string;
  suburb: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
  status: BookingStatus;
  quoteAmount?: number | null;
  adminNotes?: string;
  paid: boolean;
  source: BookingSource;
  paidAt?: string | null;      // date the booking was marked paid (editable)
  customerMarkedPaidAt?: string | null; // customer clicked "I've paid" on the invoice —
                                         // NOT the same as `paid`. Only counts once the
                                         // money is actually seen in the account.
  completedAt?: string | null; // date the job was marked completed (editable)
  assignedGuestId?: string | null; // guest (subcontractor) this job was sent to
  assignedAt?: string | null;      // when it was assigned
  scheduledAt?: string | null;     // internal calendar slot start (ISO). null = not in calendar
  scheduledEnd?: string | null;    // slot end (ISO). null = default duration from scheduledAt
  recurringId?: string | null;     // recurring plan that generated this booking (customer history)
  leadSource?: LeadSource | null;  // "how did we get this job?" (manual adds)
  groupId?: string | null;         // booking group this job belongs to
  publicToken?: string | null;     // unguessable token for the customer thank-you page
  feedbackStars?: number | null;   // customer rating 1-5 (from the thank-you page)
  feedbackText?: string | null;    // written feedback (shown for 1-3 stars)
  feedbackAt?: string | null;      // when feedback was left
  contactedAt?: string | null;     // website lead has been followed up — clears it from
                                    // "Leads to call back" without needing a status change
  sortOrder?: number | null;       // manual drag order (Bookings tab, select mode). null = unset
  autoMoved?: boolean;             // true while the CURRENT status was set by the stale-lead
                                    // job, not a person — cleared the moment anyone changes
                                    // status manually (see withAutoMoveReset)
  autoMovedAt?: string | null;     // when the auto-move happened
  autoMovedFrom?: BookingStatus | null; // status it was auto-moved from, so "Undo" can restore it
  flaggedAt?: string | null;       // set when something's gone wrong on this job; null = not flagged
  flagNote?: string | null;        // description of what went wrong
  createdAt: string;
  updatedAt: string;
}

// How a manually-added job came in. Powers the customer-sources analytics chart.
export type LeadSource = 'called-us' | 'we-called' | 'door-to-door' | 'in-person' | 'real-estate' | 'other';
export const LEAD_SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'called-us', label: 'Called us' },
  { value: 'we-called', label: 'We called them' },
  { value: 'door-to-door', label: 'Door to door' },
  { value: 'in-person', label: 'In person' },
  { value: 'real-estate', label: 'Real estate agent' },
  { value: 'other', label: 'Other' },
];

// ─── Guests (subcontractor / guest logins) ──────────────────────────────────
export interface Guest {
  id: string;            // GST-timestamp
  name: string;
  passwordHash: string;  // HMAC hash — never sent to the client
  active: boolean;
  createdAt: string;
}
export type NewGuest = { name: string; passwordHash: string; active?: boolean };

export type NewBooking = Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'paid'> & {
  status?: BookingStatus;
  source?: BookingSource;
  paid?: boolean;
};

export interface PageView {
  path: string;
  referrer: string;
  visitor: string;
  // viewId correlates this row with a later "how far did they scroll" beacon
  // sent when the visitor leaves the page — sent separately from the initial
  // view (which fires on arrival) since we don't know the final depth yet.
  // Both are optional so LARP's fake page views (which never scroll) and any
  // pre-migration rows still type-check with no data.
  viewId?: string | null;
  maxScrollPercent?: number | null;
  createdAt: string;
}
export type NewPageView = Omit<PageView, 'createdAt'>;

// ─── Job photos (before / after documentation) ──────────────────────────────
export type PhotoType = 'before' | 'after' | 'progress';
export interface BookingPhoto {
  id: string;         // PH-timestamp-rand
  bookingId: string;
  type: PhotoType;
  url: string;        // Vercel Blob URL in prod, /uploads/... locally
  createdAt: string;
}

// ─── Recurring jobs (plan customers: monthly / quarterly / biannual) ────────
export type RecurringFrequency = 'monthly' | 'quarterly' | 'biannual';
export interface RecurringJob {
  id: string;         // RJ-timestamp
  name: string;
  phone: string;
  email: string;
  address: string;
  suburb: string;
  service: string;    // comma-separated, same convention as bookings
  propertyType: PropertyType;
  frequency: RecurringFrequency;
  nextDate: string;   // YYYY-MM-DD of the next visit; advanced by the cron after each auto-create
  preferredTime: string;
  notes: string;
  discount: number | null;  // $ off per clean under the plan
  active: boolean;
  lastBookingId: string | null;
  createdAt: string;
  updatedAt: string;
}
export type NewRecurringJob = Omit<RecurringJob, 'id' | 'createdAt' | 'updatedAt' | 'lastBookingId' | 'active'> & { active?: boolean };

// ─── Storage mode ────────────────────────────────────────────────────────────
// DATABASE_URL set  → Neon Postgres (production / Vercel)
// DATABASE_URL unset → local JSON file (dev on your machine)

// The neon() HTTP driver wants the DIRECT (unpooled) endpoint. Vercel's Neon
// integration sets DATABASE_URL to the pooled host (-pooler), where the HTTP
// SQL endpoint hangs. Prefer the unpooled URL, fall back to whatever exists.
const CONN =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
const sql = CONN ? neon(CONN) : null;

export const DB_DEBUG = {
  chosen:
    process.env.DATABASE_URL_UNPOOLED ? 'DATABASE_URL_UNPOOLED'
    : process.env.POSTGRES_URL_NON_POOLING ? 'POSTGRES_URL_NON_POOLING'
    : process.env.DATABASE_URL ? 'DATABASE_URL'
    : process.env.POSTGRES_URL ? 'POSTGRES_URL' : 'none',
  host: (() => { try { return CONN ? new URL(CONN).host : null; } catch { return 'parse-failed'; } })(),
  present: {
    DATABASE_URL: !!process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: !!process.env.DATABASE_URL_UNPOOLED,
    POSTGRES_URL: !!process.env.POSTGRES_URL,
    POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
    POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
  },
};

// Fail fast instead of hanging if the DB is unreachable.
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`DB timeout after ${ms}ms`)), ms)),
  ]);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToBooking(r: any): Booking {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    service: r.service,
    propertyType: r.property_type,
    address: r.address,
    suburb: r.suburb,
    preferredDate: r.preferred_date,
    preferredTime: r.preferred_time,
    notes: r.notes ?? '',
    status: r.status,
    quoteAmount: r.quote_amount === null || r.quote_amount === undefined ? null : Number(r.quote_amount),
    adminNotes: r.admin_notes ?? '',
    paid: r.paid === true || r.paid === 1,
    source: r.source ?? 'website',
    paidAt: r.paid_at == null ? null : (typeof r.paid_at === 'string' ? r.paid_at : new Date(r.paid_at).toISOString()),
    customerMarkedPaidAt: r.customer_marked_paid_at == null ? null : (typeof r.customer_marked_paid_at === 'string' ? r.customer_marked_paid_at : new Date(r.customer_marked_paid_at).toISOString()),
    completedAt: r.completed_at == null ? null : (typeof r.completed_at === 'string' ? r.completed_at : new Date(r.completed_at).toISOString()),
    assignedGuestId: r.assigned_guest_id ?? null,
    assignedAt: r.assigned_at == null ? null : (typeof r.assigned_at === 'string' ? r.assigned_at : new Date(r.assigned_at).toISOString()),
    scheduledAt: r.scheduled_at == null ? null : (typeof r.scheduled_at === 'string' ? r.scheduled_at : new Date(r.scheduled_at).toISOString()),
    scheduledEnd: r.scheduled_end == null ? null : (typeof r.scheduled_end === 'string' ? r.scheduled_end : new Date(r.scheduled_end).toISOString()),
    recurringId: r.recurring_id ?? null,
    leadSource: r.lead_source ?? null,
    groupId: r.group_id ?? null,
    publicToken: r.public_token ?? null,
    feedbackStars: r.feedback_stars == null ? null : Number(r.feedback_stars),
    feedbackText: r.feedback_text ?? null,
    feedbackAt: r.feedback_at == null ? null : (typeof r.feedback_at === 'string' ? r.feedback_at : new Date(r.feedback_at).toISOString()),
    contactedAt: r.contacted_at == null ? null : (typeof r.contacted_at === 'string' ? r.contacted_at : new Date(r.contacted_at).toISOString()),
    sortOrder: r.sort_order == null ? null : Number(r.sort_order),
    autoMoved: r.auto_moved === true || r.auto_moved === 1,
    autoMovedAt: r.auto_moved_at == null ? null : (typeof r.auto_moved_at === 'string' ? r.auto_moved_at : new Date(r.auto_moved_at).toISOString()),
    autoMovedFrom: r.auto_moved_from ?? null,
    flaggedAt: r.flagged_at == null ? null : (typeof r.flagged_at === 'string' ? r.flagged_at : new Date(r.flagged_at).toISOString()),
    flagNote: r.flag_note ?? null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString(),
  };
}

let schemaReady: Promise<void> | null = null;
// Exported so a long-lived caller that isn't a per-request server (e.g. the
// MCP connector, spawned fresh per Claude Desktop session) can pay this
// cost once at startup, unbounded by the per-query 8s withTimeout() below —
// the first real query in a process's lifetime otherwise risks timing out
// on schema setup alone before it ever reaches the actual SELECT.
export async function ensureSchema(): Promise<void> {
  if (!sql) return;
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS bookings (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          email         TEXT NOT NULL DEFAULT '',
          phone         TEXT NOT NULL,
          service       TEXT NOT NULL,
          property_type TEXT NOT NULL,
          address       TEXT NOT NULL DEFAULT '',
          suburb        TEXT NOT NULL DEFAULT '',
          preferred_date TEXT NOT NULL DEFAULT '',
          preferred_time TEXT NOT NULL DEFAULT '',
          notes         TEXT DEFAULT '',
          status        TEXT NOT NULL DEFAULT 'pending',
          quote_amount  NUMERIC,
          admin_notes   TEXT DEFAULT '',
          paid          BOOLEAN NOT NULL DEFAULT false,
          source        TEXT NOT NULL DEFAULT 'website',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Backfill columns on pre-existing tables
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quote_amount NUMERIC`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS admin_notes TEXT DEFAULT ''`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'website'`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_marked_paid_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_guest_id TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS recurring_id TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lead_source TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_id TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS public_token TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback_stars INTEGER`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback_text TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sort_order NUMERIC`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS auto_moved BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS auto_moved_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS auto_moved_from TEXT`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flag_note TEXT`;
      // Backfill customer-link tokens for pre-existing rows.
      await sql`UPDATE bookings SET public_token = 'bk_' || substr(md5(random()::text || id), 1, 20) WHERE public_token IS NULL`;
      await sql`CREATE INDEX IF NOT EXISTS bookings_scheduled_idx ON bookings (scheduled_at)`;
      await sql`CREATE INDEX IF NOT EXISTS bookings_token_idx ON bookings (public_token)`;
      // Booking groups (batch a set of jobs under a title)
      await sql`
        CREATE TABLE IF NOT EXISTS booking_groups (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Guests (subcontractor logins)
      await sql`
        CREATE TABLE IF NOT EXISTS guests (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          active        BOOLEAN NOT NULL DEFAULT true,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Site traffic tracking
      await sql`
        CREATE TABLE IF NOT EXISTS pageviews (
          id          BIGSERIAL PRIMARY KEY,
          path        TEXT NOT NULL,
          referrer    TEXT NOT NULL DEFAULT '',
          visitor     TEXT NOT NULL DEFAULT '',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Scroll-depth tracking: view_id correlates a row with the later
      // "how far they got" beacon; max_scroll_percent stays NULL until that
      // beacon arrives (a bounce before the listener attaches is honestly
      // "no data", not a false 0%).
      await sql`ALTER TABLE pageviews ADD COLUMN IF NOT EXISTS view_id TEXT`;
      await sql`ALTER TABLE pageviews ADD COLUMN IF NOT EXISTS max_scroll_percent INTEGER`;
      await sql`CREATE INDEX IF NOT EXISTS pageviews_view_id_idx ON pageviews (view_id)`;
      await sql`CREATE INDEX IF NOT EXISTS pageviews_created_idx ON pageviews (created_at)`;
      // Job photos
      await sql`
        CREATE TABLE IF NOT EXISTS booking_photos (
          id          TEXT PRIMARY KEY,
          booking_id  TEXT NOT NULL,
          type        TEXT NOT NULL DEFAULT 'before',
          url         TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS booking_photos_booking_idx ON booking_photos (booking_id)`;
      // Recurring plan jobs
      await sql`
        CREATE TABLE IF NOT EXISTS recurring_jobs (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          phone           TEXT NOT NULL DEFAULT '',
          email           TEXT NOT NULL DEFAULT '',
          address         TEXT NOT NULL DEFAULT '',
          suburb          TEXT NOT NULL DEFAULT '',
          service         TEXT NOT NULL,
          property_type   TEXT NOT NULL DEFAULT 'residential',
          frequency       TEXT NOT NULL,
          next_date       TEXT NOT NULL,
          preferred_time  TEXT NOT NULL DEFAULT '',
          notes           TEXT DEFAULT '',
          discount        NUMERIC,
          active          BOOLEAN NOT NULL DEFAULT true,
          last_booking_id TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Invoices + an atomic per-prefix number counter
      await sql`
        CREATE TABLE IF NOT EXISTS invoices (
          id                 TEXT PRIMARY KEY,
          number             TEXT NOT NULL,
          seq                INTEGER NOT NULL,
          is_tax_invoice     BOOLEAN NOT NULL DEFAULT false,
          status             TEXT NOT NULL DEFAULT 'draft',
          from_name          TEXT NOT NULL DEFAULT '',
          from_trading_as    TEXT NOT NULL DEFAULT '',
          from_abn           TEXT NOT NULL DEFAULT '',
          from_address       TEXT NOT NULL DEFAULT '',
          from_email         TEXT NOT NULL DEFAULT '',
          from_phone         TEXT NOT NULL DEFAULT '',
          bill_to_name       TEXT NOT NULL DEFAULT '',
          bill_to_lines      TEXT NOT NULL DEFAULT '',
          client_show        BOOLEAN NOT NULL DEFAULT false,
          client_name        TEXT NOT NULL DEFAULT '',
          client_trn         TEXT NOT NULL DEFAULT '',
          client_file_no     TEXT NOT NULL DEFAULT '',
          client_claim_ref   TEXT NOT NULL DEFAULT '',
          invoice_date       TEXT NOT NULL DEFAULT '',
          service_date       TEXT NOT NULL DEFAULT '',
          due_date           TEXT NOT NULL DEFAULT '',
          items              TEXT NOT NULL DEFAULT '[]',
          subtotal           NUMERIC NOT NULL DEFAULT 0,
          total              NUMERIC NOT NULL DEFAULT 0,
          notes              TEXT NOT NULL DEFAULT '',
          pay_account_name   TEXT NOT NULL DEFAULT '',
          pay_bsb            TEXT NOT NULL DEFAULT '',
          pay_account_number TEXT NOT NULL DEFAULT '',
          token              TEXT NOT NULL,
          booking_id         TEXT,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          sent_at            TIMESTAMPTZ,
          paid_at            TIMESTAMPTZ,
          view_count         INTEGER NOT NULL DEFAULT 0,
          first_viewed_at    TIMESTAMPTZ,
          last_viewed_at     TIMESTAMPTZ,
          payment_method     TEXT,
          square_payment_link_url TEXT,
          square_order_id    TEXT,
          square_payment_id  TEXT,
          square_link_amount NUMERIC,
          square_paid_at     TIMESTAMPTZ,
          show_from_address  BOOLEAN NOT NULL DEFAULT true
        )
      `;
      // Backfill view-tracking columns on pre-existing invoice tables
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS owner_guest_id TEXT`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS booking_ids TEXT NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method TEXT`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_payment_link_url TEXT`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_order_id TEXT`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_payment_id TEXT`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_link_amount NUMERIC`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_paid_at TIMESTAMPTZ`;
      await sql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS show_from_address BOOLEAN NOT NULL DEFAULT true`;
      await sql`CREATE INDEX IF NOT EXISTS invoices_square_order_idx ON invoices (square_order_id)`;
      // Backfill the multi-link array from the legacy single booking_id.
      await sql`UPDATE invoices SET booking_ids = json_build_array(booking_id)::text WHERE (booking_ids = '[]' OR booking_ids IS NULL) AND booking_id IS NOT NULL`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS invoices_token_idx ON invoices (token)`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_idx ON invoices (number)`;
      await sql`CREATE TABLE IF NOT EXISTS invoice_counter (id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL)`;
      // Seed so the first generated invoice is GB{INVOICE_START_SEQ}.
      await sql`INSERT INTO invoice_counter (id, last_seq) VALUES (${INVOICE_PREFIX}, ${INVOICE_START_SEQ - 1}) ON CONFLICT (id) DO NOTHING`;
      // Selectable payment profiles for invoices
      await sql`
        CREATE TABLE IF NOT EXISTS payment_profiles (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL,
          account_name   TEXT NOT NULL DEFAULT '',
          bsb            TEXT NOT NULL DEFAULT '',
          account_number TEXT NOT NULL DEFAULT '',
          sort           INTEGER NOT NULL DEFAULT 0,
          builtin        BOOLEAN NOT NULL DEFAULT false,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      for (const p of SEED_PAYMENT_PROFILES) {
        await sql`
          INSERT INTO payment_profiles (id, name, account_name, bsb, account_number, sort, builtin)
          VALUES (${p.id}, ${p.name}, ${p.accountName}, ${p.bsb}, ${p.accountNumber}, ${p.sort}, ${p.builtin})
          ON CONFLICT (id) DO NOTHING
        `;
      }
      // Selectable business-info ("from") profiles for invoices — same idea as
      // payment profiles, managed from Settings -> Invoice autofill.
      await sql`
        CREATE TABLE IF NOT EXISTS business_profiles (
          id                TEXT PRIMARY KEY,
          name              TEXT NOT NULL,
          from_name         TEXT NOT NULL DEFAULT '',
          from_trading_as   TEXT NOT NULL DEFAULT '',
          from_abn          TEXT NOT NULL DEFAULT '',
          from_address      TEXT NOT NULL DEFAULT '',
          from_email        TEXT NOT NULL DEFAULT '',
          from_phone        TEXT NOT NULL DEFAULT '',
          sort              INTEGER NOT NULL DEFAULT 0,
          builtin           BOOLEAN NOT NULL DEFAULT false,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      for (const p of SEED_BUSINESS_PROFILES) {
        await sql`
          INSERT INTO business_profiles (id, name, from_name, from_trading_as, from_abn, from_address, from_email, from_phone, sort, builtin)
          VALUES (${p.id}, ${p.name}, ${p.fromName}, ${p.fromTradingAs}, ${p.fromAbn}, ${p.fromAddress}, ${p.fromEmail}, ${p.fromPhone}, ${p.sort}, ${p.builtin})
          ON CONFLICT (id) DO NOTHING
        `;
      }
      // Single-row app settings, stored as one JSON blob so adding new fields
      // later never needs a migration — see src/lib/settings.ts.
      await sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          id         TEXT PRIMARY KEY,
          data       TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Site-wide activity log — bookings/invoices/settings/guests/groups
      // changing, Square payments confirming, etc. See src/lib/activity.ts.
      await sql`
        CREATE TABLE IF NOT EXISTS activity_log (
          id         TEXT PRIMARY KEY,
          type       TEXT NOT NULL,
          summary    TEXT NOT NULL,
          meta       TEXT,
          actor      TEXT NOT NULL DEFAULT 'system',
          invoice_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS activity_log_created_idx ON activity_log (created_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS activity_log_invoice_idx ON activity_log (invoice_id)`;
      // Per-invoice public-page view sessions — one row per open, closed off
      // with a duration when the tab is hidden/closed.
      await sql`
        CREATE TABLE IF NOT EXISTS invoice_views (
          id               TEXT PRIMARY KEY,
          invoice_id       TEXT NOT NULL,
          ip               TEXT NOT NULL DEFAULT '',
          device_type      TEXT NOT NULL DEFAULT 'Unknown',
          browser          TEXT NOT NULL DEFAULT '',
          city             TEXT,
          region           TEXT,
          country          TEXT,
          started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          ended_at         TIMESTAMPTZ,
          duration_seconds INTEGER
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS invoice_views_invoice_idx ON invoice_views (invoice_id)`;
    })();
  }
  return schemaReady;
}

// ─── JSON fallback helpers (local dev) ──────────────────────────────────────
function ensureFile(): void {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2));
}
function readFile(): Booking[] {
  ensureFile();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')); } catch { return []; }
}
function writeFile(rows: Booking[]): void {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(rows, null, 2));
}

// ─── Public API (async) ──────────────────────────────────────────────────────

export async function getBookings(): Promise<Booking[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM bookings ORDER BY created_at DESC`;
      return (rows as any[]).map(rowToBooking);
    })());
  }
  return readFile().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Bookings with a calendar slot inside [startISO, endISO). Powers the internal
// calendar's day / week / month views (the calendar reads bookings directly —
// there is no separate calendar store).
export async function getBookingsInRange(startISO: string, endISO: string): Promise<Booking[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`
        SELECT * FROM bookings
        WHERE scheduled_at IS NOT NULL AND scheduled_at >= ${startISO} AND scheduled_at < ${endISO}
        ORDER BY scheduled_at ASC`;
      return (rows as any[]).map(rowToBooking);
    })());
  }
  return readFile()
    .filter(b => b.scheduledAt && b.scheduledAt >= startISO && b.scheduledAt < endISO)
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
}

export async function getBookingById(id: string): Promise<Booking | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM bookings WHERE id = ${id} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToBooking(arr[0]) : null;
  }
  return readFile().find(b => b.id === id) ?? null;
}

export async function addBooking(data: NewBooking): Promise<Booking> {
  const now = new Date().toISOString();
  const booking: Booking = {
    name: data.name,
    email: data.email ?? '',
    phone: data.phone,
    service: data.service,
    propertyType: data.propertyType,
    address: data.address ?? '',
    suburb: data.suburb ?? '',
    preferredDate: data.preferredDate ?? '',
    preferredTime: data.preferredTime ?? '',
    notes: data.notes ?? '',
    quoteAmount: data.quoteAmount ?? null,
    adminNotes: data.adminNotes ?? '',
    paid: data.paid ?? false,
    assignedGuestId: data.assignedGuestId ?? null,
    assignedAt: data.assignedGuestId ? now : null,
    scheduledAt: data.scheduledAt ?? null,
    scheduledEnd: data.scheduledEnd ?? null,
    recurringId: data.recurringId ?? null,
    leadSource: data.leadSource ?? null,
    groupId: data.groupId ?? null,
    publicToken: `bk_${crypto.randomBytes(12).toString('hex')}`,
    feedbackStars: null,
    feedbackText: null,
    feedbackAt: null,
    contactedAt: null,
    sortOrder: null,
    autoMoved: false,
    autoMovedAt: null,
    autoMovedFrom: null,
    flaggedAt: null,
    flagNote: null,
    id: `BK-${Date.now()}`,
    status: data.status ?? 'pending',
    source: data.source ?? 'website',
    createdAt: now,
    updatedAt: now,
  };

  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO bookings (id, name, email, phone, service, property_type, address, suburb, preferred_date, preferred_time, notes, status, quote_amount, admin_notes, paid, source, assigned_guest_id, assigned_at, scheduled_at, scheduled_end, recurring_id, lead_source, group_id, public_token)
      VALUES (${booking.id}, ${booking.name}, ${booking.email}, ${booking.phone}, ${booking.service}, ${booking.propertyType}, ${booking.address}, ${booking.suburb}, ${booking.preferredDate}, ${booking.preferredTime}, ${booking.notes}, ${booking.status}, ${booking.quoteAmount}, ${booking.adminNotes}, ${booking.paid}, ${booking.source}, ${booking.assignedGuestId}, ${booking.assignedAt}, ${booking.scheduledAt}, ${booking.scheduledEnd}, ${booking.recurringId}, ${booking.leadSource}, ${booking.groupId}, ${booking.publicToken})
    `;
    return booking;
  }

  const rows = readFile();
  rows.push(booking);
  writeFile(rows);
  return booking;
}

// ─── Customer thank-you link + feedback ─────────────────────────────────────

export async function getBookingByToken(token: string): Promise<Booking | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM bookings WHERE public_token = ${token} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToBooking(arr[0]) : null;
  }
  return readFile().find(b => b.publicToken === token) ?? null;
}

// Returns the booking's public token, generating + persisting one if it's an old
// row created before tokens existed.
export async function ensureBookingToken(id: string): Promise<string | null> {
  const b = await getBookingById(id);
  if (!b) return null;
  if (b.publicToken) return b.publicToken;
  const token = `bk_${crypto.randomBytes(12).toString('hex')}`;
  await updateBooking(id, { publicToken: token });
  return token;
}

// Customer taps "I've paid" on the invoice. Records the CLAIM only — never
// flips `paid` itself, since that stays a manual call once the money is
// actually seen in the account. Returns the linked booking (with a public
// token minted if it didn't have one yet) so the caller can redirect to the
// thank-you page, plus the invoice number for the admin notification.
export async function markCustomerPaidByInvoiceToken(invoiceToken: string): Promise<{ booking: Booking; invoiceNumber: string; invoiceId: string } | null> {
  const invoice = await getInvoiceByToken(invoiceToken);
  if (!invoice) return null;
  const bookingId = invoice.bookingIds[0] ?? invoice.bookingId ?? null;
  if (!bookingId) return null;
  const updated = await updateBooking(bookingId, { customerMarkedPaidAt: new Date().toISOString() });
  if (!updated) return null;
  const token = updated.publicToken ?? (await ensureBookingToken(bookingId));
  return { booking: { ...updated, publicToken: token }, invoiceNumber: invoice.number, invoiceId: invoice.id };
}

// Customer submits feedback from the thank-you page. Stars 1-5; text kept for 1-3.
export async function submitBookingFeedback(token: string, stars: number, text: string): Promise<Booking | null> {
  const b = await getBookingByToken(token);
  if (!b) return null;
  return updateBooking(b.id, {
    feedbackStars: Math.max(1, Math.min(5, Math.round(stars))),
    feedbackText: text ?? '',
    feedbackAt: new Date().toISOString(),
  });
}

// Stamp completedAt the first time a booking flips to "completed", unless the
// caller passed an explicit value (e.g. the owner edited the completion date).
function withCompletedAt(cur: Booking, updates: Partial<Booking>): Partial<Booking> {
  if ('completedAt' in updates) return updates; // explicit edit (incl. clearing it)
  if (updates.status === 'completed' && cur.status !== 'completed' && !cur.completedAt) {
    return { ...updates, completedAt: new Date().toISOString() };
  }
  return updates;
}

// Stamp paidAt the first time a booking flips to paid, unless the caller passed
// an explicit value (e.g. the owner edited or cleared the paid date).
function withPaidAt(cur: Booking, updates: Partial<Booking>): Partial<Booking> {
  if ('paidAt' in updates) return updates; // explicit edit (incl. clearing it)
  if (updates.paid === true && !cur.paid && !cur.paidAt) {
    return { ...updates, paidAt: new Date().toISOString() };
  }
  return updates;
}

// Stamp assignedAt whenever the assigned guest changes (and clear it on unassign).
function withAssignedAt(cur: Booking, updates: Partial<Booking>): Partial<Booking> {
  if (!('assignedGuestId' in updates)) return updates;
  if (updates.assignedGuestId && updates.assignedGuestId !== cur.assignedGuestId) {
    return { ...updates, assignedAt: new Date().toISOString() };
  }
  if (!updates.assignedGuestId) return { ...updates, assignedAt: null };
  return updates;
}

// A status set by a person (admin, guest, or bulk action) clears the "auto"
// tag — it's no longer true that the system moved it there unattended.
// checkStaleLeads() bypasses this by passing `autoMoved` explicitly alongside
// `status`, so the tag survives the move that set it.
function withAutoMoveReset(updates: Partial<Booking>): Partial<Booking> {
  if ('status' in updates && !('autoMoved' in updates)) {
    return { ...updates, autoMoved: false, autoMovedAt: null, autoMovedFrom: null };
  }
  return updates;
}

export async function updateBooking(id: string, rawUpdates: Partial<Booking>): Promise<Booking | null> {
  if (sql) {
    await ensureSchema();
    const cur = await getBookingById(id);
    if (!cur) return null;
    const updates = withAutoMoveReset(withAssignedAt(cur, withPaidAt(cur, withCompletedAt(cur, rawUpdates))));
    const m = { ...cur, ...updates };
    const rows = await sql`
      UPDATE bookings SET
        name = ${m.name},
        email = ${m.email ?? ''},
        phone = ${m.phone ?? ''},
        service = ${m.service},
        property_type = ${m.propertyType},
        address = ${m.address ?? ''},
        suburb = ${m.suburb ?? ''},
        status = ${m.status},
        quote_amount = ${m.quoteAmount ?? null},
        admin_notes = ${m.adminNotes ?? ''},
        paid = ${m.paid ?? false},
        notes = ${m.notes ?? ''},
        preferred_date = ${m.preferredDate ?? ''},
        preferred_time = ${m.preferredTime ?? ''},
        completed_at = ${m.completedAt ?? null},
        paid_at = ${m.paidAt ?? null},
        customer_marked_paid_at = ${m.customerMarkedPaidAt ?? null},
        assigned_guest_id = ${m.assignedGuestId ?? null},
        assigned_at = ${m.assignedAt ?? null},
        scheduled_at = ${m.scheduledAt ?? null},
        scheduled_end = ${m.scheduledEnd ?? null},
        recurring_id = ${m.recurringId ?? null},
        lead_source = ${m.leadSource ?? null},
        group_id = ${m.groupId ?? null},
        public_token = ${m.publicToken ?? null},
        feedback_stars = ${m.feedbackStars ?? null},
        feedback_text = ${m.feedbackText ?? null},
        feedback_at = ${m.feedbackAt ?? null},
        contacted_at = ${m.contactedAt ?? null},
        sort_order = ${m.sortOrder ?? null},
        auto_moved = ${m.autoMoved ?? false},
        auto_moved_at = ${m.autoMovedAt ?? null},
        auto_moved_from = ${m.autoMovedFrom ?? null},
        flagged_at = ${m.flaggedAt ?? null},
        flag_note = ${m.flagNote ?? null},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    const arr = rows as any[];
    return arr.length ? rowToBooking(arr[0]) : null;
  }

  const rows = readFile();
  const idx = rows.findIndex(b => b.id === id);
  if (idx === -1) return null;
  const updates = withAutoMoveReset(withAssignedAt(rows[idx], withPaidAt(rows[idx], withCompletedAt(rows[idx], rawUpdates))));
  rows[idx] = { ...rows[idx], ...updates, updatedAt: new Date().toISOString() };
  writeFile(rows);
  return rows[idx];
}

// ─── Manual drag order + stale-lead auto-move (Bookings tab, select mode) ───

// Persist a new manual order: ids in display order get sort_order 0..n-1.
export async function bulkReorderBookings(ids: string[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < ids.length; i++) { if (await updateBooking(ids[i], { sortOrder: i })) n++; }
  return n;
}

const STALE_LEAD_DAYS = 14;

// A "pending" job nobody has actioned in 14 days gets auto-moved to "cold"
// so it drops out of the active list instead of quietly rotting at the top.
// Runs on-demand (called once when the dashboard loads) rather than on a
// cron, so "next time someone checks the site" is literally true. Returns
// only the bookings THIS call just moved, which is exactly what the
// dashboard needs to show the one-time "moved to cold" popup.
export async function checkStaleLeads(): Promise<Booking[]> {
  const all = await getBookings();
  const cutoff = Date.now() - STALE_LEAD_DAYS * 24 * 60 * 60 * 1000;
  const stale = all.filter(b => b.status === 'pending' && new Date(b.createdAt).getTime() <= cutoff);
  const moved: Booking[] = [];
  for (const b of stale) {
    const updated = await updateBooking(b.id, {
      status: 'cold', autoMoved: true, autoMovedAt: new Date().toISOString(), autoMovedFrom: b.status,
    });
    if (updated) {
      moved.push(updated);
      void logActivity('booking.auto_moved_cold', `${updated.name}: pending ${STALE_LEAD_DAYS}d with no update, auto-moved to Cold Lead`, { bookingId: updated.id }, 'system');
    }
  }
  return moved;
}

// "Undo" on the stale-lead popup: put it back exactly where it was, no prompt.
export async function undoAutoMove(id: string): Promise<Booking | null> {
  const cur = await getBookingById(id);
  if (!cur || !cur.autoMoved || !cur.autoMovedFrom) return null;
  return updateBooking(id, { status: cur.autoMovedFrom, autoMoved: false, autoMovedAt: null, autoMovedFrom: null });
}

// ─── LARP mode (src/lib/larp.ts builds the fake rows, these just move them) ─

// Inserts a fully pre-built Booking row as-is — unlike addBooking(), the
// caller controls id/createdAt/status/etc, which is what backdating a
// realistic LARP-mode job history needs.
export async function insertRawBooking(booking: Booking): Promise<void> {
  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO bookings (
        id, name, email, phone, service, property_type, address, suburb, preferred_date, preferred_time,
        notes, status, quote_amount, admin_notes, paid, source, assigned_guest_id, assigned_at,
        scheduled_at, scheduled_end, recurring_id, lead_source, group_id, public_token,
        completed_at, paid_at, created_at, updated_at
      ) VALUES (
        ${booking.id}, ${booking.name}, ${booking.email}, ${booking.phone}, ${booking.service}, ${booking.propertyType},
        ${booking.address}, ${booking.suburb}, ${booking.preferredDate}, ${booking.preferredTime},
        ${booking.notes}, ${booking.status}, ${booking.quoteAmount ?? null}, ${booking.adminNotes ?? ''}, ${booking.paid},
        ${booking.source}, ${booking.assignedGuestId ?? null}, ${booking.assignedAt ?? null},
        ${booking.scheduledAt ?? null}, ${booking.scheduledEnd ?? null}, ${booking.recurringId ?? null},
        ${booking.leadSource ?? null}, ${booking.groupId ?? null}, ${booking.publicToken ?? null},
        ${booking.completedAt ?? null}, ${booking.paidAt ?? null}, ${booking.createdAt}, ${booking.updatedAt}
      )
    `;
    return;
  }
  const rows = readFile();
  rows.push(booking);
  writeFile(rows);
}

// Bulk-clean by id prefix — LARP-mode rows all share an id prefix, so turning
// LARP mode off is exactly "delete everything with this prefix," and can
// never touch a real booking (real ids are always `BK-<timestamp>`).
export async function deleteBookingsByIdPrefix(prefix: string): Promise<number> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM bookings WHERE id LIKE ${prefix + '%'} RETURNING id`;
    return (rows as any[]).length;
  }
  const rows = readFile();
  const kept = rows.filter(b => !b.id.startsWith(prefix));
  const removed = rows.length - kept.length;
  writeFile(kept);
  return removed;
}

export async function deleteBooking(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM bookings WHERE id = ${id} RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const rows = readFile();
  const filtered = rows.filter(b => b.id !== id);
  if (filtered.length === rows.length) return false;
  writeFile(filtered);
  return true;
}

export async function getStats() {
  const bookings = await getBookings();
  const now = new Date();

  const thisMonth = bookings.filter(b => {
    const d = new Date(b.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const lastMonth = bookings.filter(b => {
    const d = new Date(b.createdAt);
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
  });

  const byMonth: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
    byMonth[key] = 0;
  }
  bookings.forEach(b => {
    const d = new Date(b.createdAt);
    const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (monthsAgo >= 0 && monthsAgo < 6) {
      const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      byMonth[key] = (byMonth[key] || 0) + 1;
    }
  });

  const hasService = (b: Booking, key: string) => (b.service ?? '').split(',').includes(key);
  const serviceBreakdown = {
    'Window Washing': bookings.filter(b => hasService(b, 'window-washing')).length,
    'Pressure Washing': bookings.filter(b => hasService(b, 'pressure-washing')).length,
    'Flyscreen Repair': bookings.filter(b => hasService(b, 'flyscreen-repair')).length,
    'Solar Panel Cleaning': bookings.filter(b => hasService(b, 'solar-panel-cleaning')).length,
    'Other': bookings.filter(b => hasService(b, 'other')).length,
    'Both Services': bookings.filter(b => hasService(b, 'both')).length, // legacy records
  };

  const statusBreakdown = {
    pending: bookings.filter(b => b.status === 'pending').length,
    quoted: bookings.filter(b => b.status === 'quoted').length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    completed: bookings.filter(b => b.status === 'completed').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
    cold: bookings.filter(b => b.status === 'cold').length,
  };

  // Quote tracking: total $ value of every booking we've put a quote on.
  const quotedBookings = bookings.filter(b => typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0);
  const quotedValue = quotedBookings.reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);

  // Revenue = money actually collected (anything marked paid).
  const paidValue = bookings
    .filter(b => b.paid && typeof b.quoteAmount === 'number')
    .reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);
  // Owed = work that's done but not yet paid (accounts receivable).
  const owedValue = bookings
    .filter(b => !b.paid && b.status === 'completed' && typeof b.quoteAmount === 'number')
    .reduce((sum, b) => sum + (b.quoteAmount ?? 0), 0);
  const owedCount = bookings.filter(b => !b.paid && b.status === 'completed' && typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0).length;

  return {
    total: bookings.length,
    thisMonth: thisMonth.length,
    lastMonth: lastMonth.length,
    pending: statusBreakdown.pending,
    quoted: statusBreakdown.quoted,
    confirmed: statusBreakdown.confirmed,
    completed: statusBreakdown.completed,
    cancelled: statusBreakdown.cancelled,
    cold: statusBreakdown.cold,
    quotedCount: quotedBookings.length,
    quotedValue,
    paidValue,
    owedValue,
    owedCount,
    wonValue: paidValue,            // revenue won = money collected
    estimatedRevenue: paidValue,    // real revenue = paid only
    byMonth: Object.entries(byMonth).map(([month, count]) => ({ month, count })),
    serviceBreakdown: Object.entries(serviceBreakdown).map(([name, value]) => ({ name, value })),
    statusBreakdown,
    avgPerMonth: bookings.length > 0 ? Math.round(bookings.length / Math.max(1, Object.keys(byMonth).length)) : 0,
  };
}

// ─── Page views / site traffic ───────────────────────────────────────────────

function readPV(): PageView[] {
  try {
    if (!fs.existsSync(PV_PATH)) return [];
    return JSON.parse(fs.readFileSync(PV_PATH, 'utf-8'));
  } catch { return []; }
}
function writePV(rows: PageView[]): void {
  const dir = path.dirname(PV_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PV_PATH, JSON.stringify(rows, null, 2));
}

export async function addPageView(data: NewPageView): Promise<void> {
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO pageviews (path, referrer, visitor, view_id) VALUES (${data.path}, ${data.referrer}, ${data.visitor}, ${data.viewId ?? null})`;
    return;
  }
  const rows = readPV();
  rows.push({ ...data, createdAt: new Date().toISOString() });
  writePV(rows);
}

// Best-effort update from the "how far did they scroll before leaving"
// beacon — arrives after the initial view row already exists (sometimes long
// after, sometimes never, if the tab was killed outright). Never throws:
// this must not be able to break the page it's reporting on.
export async function updatePageViewScroll(viewId: string, percent: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  try {
    if (sql) {
      await ensureSchema();
      await sql`UPDATE pageviews SET max_scroll_percent = GREATEST(COALESCE(max_scroll_percent, 0), ${clamped}) WHERE view_id = ${viewId}`;
      return;
    }
    const rows = readPV();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].viewId === viewId) {
        rows[i].maxScrollPercent = Math.max(rows[i].maxScrollPercent ?? 0, clamped);
        break;
      }
    }
    writePV(rows);
  } catch (err) {
    console.error('[track] updatePageViewScroll failed:', err);
  }
}

// LARP mode ("fake numbers"): a pre-built page view with a controlled
// createdAt, for backdating fake traffic onto the same story arc as the fake
// bookings. pageviews.id is a bigserial (no text id to tag by prefix), so
// cleanup instead matches on visitor LIKE 'larp_%' — see deletePageViewsByVisitorPrefix.
export async function insertRawPageView(row: PageView): Promise<void> {
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO pageviews (path, referrer, visitor, created_at, view_id) VALUES (${row.path}, ${row.referrer}, ${row.visitor}, ${row.createdAt}, ${row.viewId ?? null})`;
    return;
  }
  const rows = readPV();
  rows.push(row);
  writePV(rows);
}

export async function deletePageViewsByVisitorPrefix(prefix: string): Promise<number> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM pageviews WHERE visitor LIKE ${prefix + '%'} RETURNING visitor`;
    return (rows as any[]).length;
  }
  const rows = readPV();
  const kept = rows.filter(v => !v.visitor.startsWith(prefix));
  const removed = rows.length - kept.length;
  writePV(kept);
  return removed;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Raw page views for the last `days` days, plus an all-time count. Factored
// out of getSiteStats() so callers that need to filter the raw rows first
// (e.g. excluding LARP-mode fake traffic — visitor prefix 'larp_') can do so
// without re-implementing the query.
export async function getPageViews(days = 30): Promise<{ views: PageView[]; allTime: number }> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let views: PageView[];
  let allTime = 0;

  if (sql) {
    await ensureSchema();
    const rows = await withTimeout((async () =>
      sql`SELECT path, referrer, visitor, created_at, max_scroll_percent FROM pageviews WHERE created_at >= ${since.toISOString()} ORDER BY created_at DESC`)());
    views = (rows as any[]).map(r => ({
      path: r.path, referrer: r.referrer ?? '', visitor: r.visitor ?? '',
      maxScrollPercent: r.max_scroll_percent == null ? null : Number(r.max_scroll_percent),
      createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    }));
    const c = await sql`SELECT count(*)::int AS n FROM pageviews`;
    allTime = (c as any[])[0]?.n ?? 0;
  } else {
    const all = readPV();
    allTime = all.length;
    views = all.filter(v => new Date(v.createdAt) >= since);
  }
  return { views, allTime };
}

export async function getSiteStats() {
  // Pull the last 30 days of views, aggregate in JS (works for both stores).
  const { views, allTime } = await getPageViews(30);

  const now = new Date();
  const todayKey = dayKey(now);
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const today = views.filter(v => dayKey(new Date(v.createdAt)) === todayKey).length;
  const last7 = views.filter(v => new Date(v.createdAt) >= sevenAgo).length;
  const uniqueVisitors = new Set(views.map(v => v.visitor).filter(Boolean)).size;

  // Views by day, last 14 days
  const byDay: { day: string; views: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(d);
    const label = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    byDay.push({ day: label, views: views.filter(v => dayKey(new Date(v.createdAt)) === key).length });
  }

  // Top pages
  const pageCounts: Record<string, number> = {};
  views.forEach(v => { pageCounts[v.path] = (pageCounts[v.path] ?? 0) + 1; });

  // Scroll depth: how far down the page people got before leaving. Only
  // views that actually reported a beacon count (a bounce before the JS
  // listener attaches, or a killed tab, means no data — that's honestly
  // different from "left at 0%", so it's excluded rather than counted as 0).
  const withScroll = views.filter((v): v is PageView & { maxScrollPercent: number } => typeof v.maxScrollPercent === 'number');
  const scrollByPage: Record<string, { sum: number; count: number }> = {};
  withScroll.forEach(v => {
    const e = scrollByPage[v.path] ?? (scrollByPage[v.path] = { sum: 0, count: 0 });
    e.sum += v.maxScrollPercent;
    e.count += 1;
  });
  const scrollBuckets = [
    { label: '0–25%', min: 0, max: 25 },
    { label: '26–50%', min: 26, max: 50 },
    { label: '51–75%', min: 51, max: 75 },
    { label: '76–100%', min: 76, max: 100 },
  ].map(b => ({
    label: b.label,
    count: withScroll.filter(v => v.maxScrollPercent >= b.min && v.maxScrollPercent <= b.max).length,
  }));

  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([path, views]) => ({
      path, views,
      avgScrollPercent: scrollByPage[path] ? Math.round(scrollByPage[path].sum / scrollByPage[path].count) : null,
      scrollSamples: scrollByPage[path]?.count ?? 0,
    }));

  // Top referrers (external only)
  const refCounts: Record<string, number> = {};
  views.forEach(v => {
    if (!v.referrer) return;
    let host = v.referrer;
    try { host = new URL(v.referrer).hostname.replace(/^www\./, ''); } catch {}
    if (!host) return;
    refCounts[host] = (refCounts[host] ?? 0) + 1;
  });
  const topReferrers = Object.entries(refCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([source, views]) => ({ source, views }));

  return {
    allTimeViews: allTime,
    views30d: views.length,
    today,
    last7,
    uniqueVisitors,
    byDay,
    topPages,
    topReferrers,
    scrollBuckets,
    scrollSampleCount: withScroll.length,
    directShare: views.length ? Math.round(((views.length - Object.values(refCounts).reduce((a, b) => a + b, 0)) / views.length) * 100) : 0,
  };
}

export async function getBusinessStats() {
  const bookings = await getBookings();
  const invoices = await getInvoices();
  const total = bookings.length;
  const completed = bookings.filter(b => b.status === 'completed').length;
  const withQuote = bookings.filter(b => typeof b.quoteAmount === 'number' && (b.quoteAmount ?? 0) > 0);

  const paidValue = bookings.filter(b => b.paid).reduce((s, b) => s + (b.quoteAmount ?? 0), 0);
  const owedValue = bookings
    .filter(b => !b.paid && b.status === 'completed')
    .reduce((s, b) => s + (b.quoteAmount ?? 0), 0);
  const avgQuote = withQuote.length ? Math.round(withQuote.reduce((s, b) => s + (b.quoteAmount ?? 0), 0) / withQuote.length) : 0;
  const conversionRate = total ? Math.round((completed / total) * 100) : 0;

  // Revenue (paid) by month, last 6 months
  const now = new Date();
  const revByMonth: { month: string; revenue: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toLocaleString('default', { month: 'short', year: '2-digit' });
    const revenue = bookings
      .filter(b => b.paid)
      .filter(b => {
        const cd = new Date(b.createdAt);
        return cd.getMonth() === d.getMonth() && cd.getFullYear() === d.getFullYear();
      })
      .reduce((s, b) => s + (b.quoteAmount ?? 0), 0);
    revByMonth.push({ month: key, revenue });
  }

  // Top suburbs
  const subCounts: Record<string, number> = {};
  bookings.forEach(b => {
    const s = (b.suburb || '').trim();
    if (!s) return;
    subCounts[s] = (subCounts[s] ?? 0) + 1;
  });
  const topSuburbs = Object.entries(subCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([suburb, count]) => ({ suburb, count }));

  const hasService = (b: Booking, key: string) => (b.service ?? '').split(',').includes(key);
  const serviceBreakdown = {
    'Window Washing': bookings.filter(b => hasService(b, 'window-washing')).length,
    'Pressure Washing': bookings.filter(b => hasService(b, 'pressure-washing')).length,
    'Flyscreen Repair': bookings.filter(b => hasService(b, 'flyscreen-repair')).length,
    'Solar Panel Cleaning': bookings.filter(b => hasService(b, 'solar-panel-cleaning')).length,
    'Other': bookings.filter(b => hasService(b, 'other')).length,
    'Both Services': bookings.filter(b => hasService(b, 'both')).length, // legacy records
  };

  // Debtor days: whole days from an invoice being marked sent to being marked
  // paid, averaged across every invoice where both timestamps exist.
  const debtorSamples = invoices.map(debtorDays).filter((d): d is number => d != null);
  const avgDebtorDays = debtorSamples.length ? Math.round(debtorSamples.reduce((a, b) => a + b, 0) / debtorSamples.length) : null;

  // Overdue: sent, unpaid, past the due date.
  const overdueInvoices = invoices.filter(isInvoiceOverdue);
  const overdueCount = overdueInvoices.length;
  const overdueValue = overdueInvoices.reduce((s, i) => s + i.total, 0);

  return {
    total,
    completed,
    conversionRate,
    avgQuote,
    paidValue,
    owedValue,
    quotedCount: withQuote.length,
    leadsBySource: {
      website: bookings.filter(b => (b.source ?? 'website') === 'website').length,
      manual: bookings.filter(b => b.source === 'manual').length,
    },
    revByMonth,
    topSuburbs,
    serviceBreakdown: Object.entries(serviceBreakdown).map(([name, value]) => ({ name, value })),
    avgDebtorDays,
    overdueCount,
    overdueValue,
  };
}

// ─── Booking photos ──────────────────────────────────────────────────────────

function readPhotos(): BookingPhoto[] {
  try {
    if (!fs.existsSync(PHOTO_PATH)) return [];
    return JSON.parse(fs.readFileSync(PHOTO_PATH, 'utf-8'));
  } catch { return []; }
}
function writePhotos(rows: BookingPhoto[]): void {
  const dir = path.dirname(PHOTO_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PHOTO_PATH, JSON.stringify(rows, null, 2));
}

function rowToPhoto(r: any): BookingPhoto {
  return {
    id: r.id,
    bookingId: r.booking_id,
    type: r.type,
    url: r.url,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  };
}

export async function getPhotos(bookingId: string): Promise<BookingPhoto[]> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM booking_photos WHERE booking_id = ${bookingId} ORDER BY created_at ASC`;
    return (rows as any[]).map(rowToPhoto);
  }
  return readPhotos().filter(p => p.bookingId === bookingId);
}

export async function addPhoto(data: { bookingId: string; type: PhotoType; url: string }): Promise<BookingPhoto> {
  const photo: BookingPhoto = {
    id: `PH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    bookingId: data.bookingId,
    type: data.type,
    url: data.url,
    createdAt: new Date().toISOString(),
  };
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO booking_photos (id, booking_id, type, url) VALUES (${photo.id}, ${photo.bookingId}, ${photo.type}, ${photo.url})`;
    return photo;
  }
  const rows = readPhotos();
  rows.push(photo);
  writePhotos(rows);
  return photo;
}

// Returns the deleted photo (caller needs the url to remove the blob file too).
export async function deletePhoto(id: string): Promise<BookingPhoto | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM booking_photos WHERE id = ${id} RETURNING *`;
    const arr = rows as any[];
    return arr.length ? rowToPhoto(arr[0]) : null;
  }
  const rows = readPhotos();
  const idx = rows.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const [removed] = rows.splice(idx, 1);
  writePhotos(rows);
  return removed;
}

// ─── Recurring jobs ──────────────────────────────────────────────────────────

function readRecurring(): RecurringJob[] {
  try {
    if (!fs.existsSync(RECURRING_PATH)) return [];
    return JSON.parse(fs.readFileSync(RECURRING_PATH, 'utf-8'));
  } catch { return []; }
}
function writeRecurring(rows: RecurringJob[]): void {
  const dir = path.dirname(RECURRING_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RECURRING_PATH, JSON.stringify(rows, null, 2));
}

function rowToRecurring(r: any): RecurringJob {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? '',
    email: r.email ?? '',
    address: r.address ?? '',
    suburb: r.suburb ?? '',
    service: r.service,
    propertyType: r.property_type ?? 'residential',
    frequency: r.frequency,
    nextDate: r.next_date,
    preferredTime: r.preferred_time ?? '',
    notes: r.notes ?? '',
    discount: r.discount === null || r.discount === undefined ? null : Number(r.discount),
    active: r.active === true || r.active === 1,
    lastBookingId: r.last_booking_id ?? null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString(),
  };
}

export async function getRecurringJobs(): Promise<RecurringJob[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM recurring_jobs ORDER BY next_date ASC`;
      return (rows as any[]).map(rowToRecurring);
    })());
  }
  return readRecurring().sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

export async function addRecurringJob(data: NewRecurringJob): Promise<RecurringJob> {
  const now = new Date().toISOString();
  const job: RecurringJob = {
    id: `RJ-${Date.now()}`,
    name: data.name,
    phone: data.phone ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
    suburb: data.suburb ?? '',
    service: data.service,
    propertyType: data.propertyType ?? 'residential',
    frequency: data.frequency,
    nextDate: data.nextDate,
    preferredTime: data.preferredTime ?? '',
    notes: data.notes ?? '',
    discount: data.discount ?? null,
    active: data.active ?? true,
    lastBookingId: null,
    createdAt: now,
    updatedAt: now,
  };
  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO recurring_jobs (id, name, phone, email, address, suburb, service, property_type, frequency, next_date, preferred_time, notes, discount, active)
      VALUES (${job.id}, ${job.name}, ${job.phone}, ${job.email}, ${job.address}, ${job.suburb}, ${job.service}, ${job.propertyType}, ${job.frequency}, ${job.nextDate}, ${job.preferredTime}, ${job.notes}, ${job.discount}, ${job.active})
    `;
    return job;
  }
  const rows = readRecurring();
  rows.push(job);
  writeRecurring(rows);
  return job;
}

// LARP mode: a pre-built plan, id and all — same idea as insertRawBooking.
export async function insertRawRecurringJob(job: RecurringJob): Promise<void> {
  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO recurring_jobs (id, name, phone, email, address, suburb, service, property_type, frequency, next_date, preferred_time, notes, discount, active, created_at, updated_at)
      VALUES (${job.id}, ${job.name}, ${job.phone}, ${job.email}, ${job.address}, ${job.suburb}, ${job.service}, ${job.propertyType}, ${job.frequency}, ${job.nextDate}, ${job.preferredTime}, ${job.notes}, ${job.discount}, ${job.active}, ${job.createdAt}, ${job.updatedAt})
    `;
    return;
  }
  const rows = readRecurring();
  rows.push(job);
  writeRecurring(rows);
}

export async function deleteRecurringByIdPrefix(prefix: string): Promise<number> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM recurring_jobs WHERE id LIKE ${prefix + '%'} RETURNING id`;
    return (rows as any[]).length;
  }
  const rows = readRecurring();
  const kept = rows.filter(j => !j.id.startsWith(prefix));
  const removed = rows.length - kept.length;
  writeRecurring(kept);
  return removed;
}

export async function updateRecurringJob(id: string, updates: Partial<RecurringJob>): Promise<RecurringJob | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM recurring_jobs WHERE id = ${id} LIMIT 1`;
    const arr = rows as any[];
    if (!arr.length) return null;
    const m = { ...rowToRecurring(arr[0]), ...updates };
    const updated = await sql`
      UPDATE recurring_jobs SET
        name = ${m.name}, phone = ${m.phone}, email = ${m.email},
        address = ${m.address}, suburb = ${m.suburb}, service = ${m.service},
        property_type = ${m.propertyType}, frequency = ${m.frequency},
        next_date = ${m.nextDate}, preferred_time = ${m.preferredTime},
        notes = ${m.notes}, discount = ${m.discount ?? null}, active = ${m.active},
        last_booking_id = ${m.lastBookingId}, updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    const uarr = updated as any[];
    return uarr.length ? rowToRecurring(uarr[0]) : null;
  }
  const rows = readRecurring();
  const idx = rows.findIndex(j => j.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...updates, updatedAt: new Date().toISOString() };
  writeRecurring(rows);
  return rows[idx];
}

export async function deleteRecurringJob(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM recurring_jobs WHERE id = ${id} RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const rows = readRecurring();
  const filtered = rows.filter(j => j.id !== id);
  if (filtered.length === rows.length) return false;
  writeRecurring(filtered);
  return true;
}

// Advance a YYYY-MM-DD date by the plan's cadence. Clamps to end of month
// (e.g. 31 Jan + 1 month = 28/29 Feb, not 3 Mar).
export function advanceDate(dateStr: string, frequency: RecurringFrequency): string {
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 6;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

// Create bookings for every active recurring job that has come due, then push
// its nextDate forward one cycle. Called by the daily cron. Returns what it made.
// Create one confirmed, calendar-scheduled booking from a plan's current
// nextDate, then advance the plan a cycle. Shared by the daily cron and the
// manual "generate next visit" action. The booking carries recurringId so the
// customer's visit history stays linked to the plan.
async function createBookingFromPlan(job: RecurringJob): Promise<{ job: RecurringJob; booking: Booking }> {
  // Default recurring visits to the configured start time (Settings ->
  // Scheduling) on the due date; editable on the calendar afterwards. This is
  // what "generates the future calendar entry".
  const settings = await getSettings();
  const scheduledAt = new Date(`${job.nextDate}T${settings.defaultJobStartTime}:00`).toISOString();
  const booking = await addBooking({
    name: job.name,
    phone: job.phone,
    email: job.email,
    address: job.address,
    suburb: job.suburb,
    // Bookings store services as a comma-separated string (same as the website form)
    service: job.service as ServiceType,
    propertyType: job.propertyType,
    preferredDate: job.nextDate,
    preferredTime: job.preferredTime,
    notes: job.notes,
    quoteAmount: null,
    adminNotes: `Auto-created from ${job.frequency} plan ${job.id}${job.discount ? ` (plan discount $${job.discount}/clean)` : ''}`,
    status: 'confirmed',
    source: 'manual',
    scheduledAt,
    recurringId: job.id,
  });
  const advanced = await updateRecurringJob(job.id, {
    nextDate: advanceDate(job.nextDate, job.frequency),
    lastBookingId: booking.id,
  });
  return { job: advanced ?? job, booking };
}

export async function runRecurringDue(): Promise<{ job: RecurringJob; booking: Booking }[]> {
  // Settings -> Scheduling -> "Recurring auto-book enabled" pauses just the
  // unattended daily cron; the manual "generate next visit" button still works.
  if (!(await getSettings()).recurringAutoBookEnabled) return [];
  const today = new Date().toISOString().slice(0, 10);
  const jobs = await getRecurringJobs();
  // Defense in depth: LARP-mode plans should never auto-book a real, untagged
  // booking via the daily cron, no matter how far out their nextDate ended up
  // or how long LARP mode is left on. See src/lib/larp.ts.
  const due = jobs.filter(j => j.active && j.nextDate <= today && !j.id.startsWith('LARP-'));
  const created: { job: RecurringJob; booking: Booking }[] = [];
  for (const job of due) created.push(await createBookingFromPlan(job));
  return created;
}

// Manually roll a plan forward one visit now (regardless of due date), placing a
// scheduled booking on the calendar. Returns the created booking + advanced plan.
export async function generateNextVisit(planId: string): Promise<{ job: RecurringJob; booking: Booking } | null> {
  const job = (await getRecurringJobs()).find(j => j.id === planId);
  if (!job) return null;
  return createBookingFromPlan(job);
}

// A customer's recurring visit history: every booking generated by a plan.
export async function getBookingsForRecurring(planId: string): Promise<Booking[]> {
  const all = await getBookings();
  return all.filter(b => b.recurringId === planId);
}

// ─── Invoices ────────────────────────────────────────────────────────────────

function readInvoices(): Invoice[] {
  try {
    if (!fs.existsSync(INVOICE_PATH)) return [];
    return JSON.parse(fs.readFileSync(INVOICE_PATH, 'utf-8'));
  } catch { return []; }
}
function writeInvoices(rows: Invoice[]): void {
  const dir = path.dirname(INVOICE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INVOICE_PATH, JSON.stringify(rows, null, 2));
}

function parseItems(raw: any): InvoiceLineItem[] {
  if (Array.isArray(raw)) return raw;
  try {
    const arr = JSON.parse(raw ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function rowToInvoice(r: any): Invoice {
  const items = parseItems(r.items);
  return {
    id: r.id,
    number: r.number,
    seq: Number(r.seq),
    isTaxInvoice: r.is_tax_invoice === true || r.is_tax_invoice === 1,
    status: r.status as InvoiceStatus,
    paymentMethod: r.payment_method ?? null,
    squarePaymentLinkUrl: r.square_payment_link_url ?? null,
    squareOrderId: r.square_order_id ?? null,
    squarePaymentId: r.square_payment_id ?? null,
    squareLinkAmount: r.square_link_amount == null ? null : Number(r.square_link_amount),
    squarePaidAt: r.square_paid_at == null ? null : (typeof r.square_paid_at === 'string' ? r.square_paid_at : new Date(r.square_paid_at).toISOString()),
    fromName: r.from_name ?? '',
    fromTradingAs: r.from_trading_as ?? '',
    fromAbn: r.from_abn ?? '',
    fromAddress: r.from_address ?? '',
    fromEmail: r.from_email ?? '',
    fromPhone: r.from_phone ?? '',
    showFromAddress: r.show_from_address !== false && r.show_from_address !== 0,
    billToName: r.bill_to_name ?? '',
    billToLines: r.bill_to_lines ?? '',
    client: {
      show: r.client_show === true || r.client_show === 1,
      clientName: r.client_name ?? '',
      trn: r.client_trn ?? '',
      fileNo: r.client_file_no ?? '',
      claimRef: r.client_claim_ref ?? '',
    },
    invoiceDate: r.invoice_date ?? '',
    serviceDate: r.service_date ?? '',
    dueDate: r.due_date ?? '',
    items,
    subtotal: r.subtotal == null ? 0 : Number(r.subtotal),
    total: r.total == null ? 0 : Number(r.total),
    notes: r.notes ?? '',
    payAccountName: r.pay_account_name ?? '',
    payBsb: r.pay_bsb ?? '',
    payAccountNumber: r.pay_account_number ?? '',
    token: r.token,
    bookingId: r.booking_id ?? null,
    bookingIds: (() => {
      const raw = r.booking_ids;
      let arr: unknown[] = [];
      if (Array.isArray(raw)) arr = raw;
      else { try { const p = JSON.parse(raw ?? '[]'); if (Array.isArray(p)) arr = p; } catch { /* ignore */ } }
      const ids = arr.filter((x): x is string => typeof x === 'string' && !!x);
      return ids.length === 0 && r.booking_id ? [r.booking_id] : ids;
    })(),
    ownerGuestId: r.owner_guest_id ?? null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString(),
    sentAt: r.sent_at == null ? null : (typeof r.sent_at === 'string' ? r.sent_at : new Date(r.sent_at).toISOString()),
    paidAt: r.paid_at == null ? null : (typeof r.paid_at === 'string' ? r.paid_at : new Date(r.paid_at).toISOString()),
    viewCount: r.view_count == null ? 0 : Number(r.view_count),
    firstViewedAt: r.first_viewed_at == null ? null : (typeof r.first_viewed_at === 'string' ? r.first_viewed_at : new Date(r.first_viewed_at).toISOString()),
    lastViewedAt: r.last_viewed_at == null ? null : (typeof r.last_viewed_at === 'string' ? r.last_viewed_at : new Date(r.last_viewed_at).toISOString()),
  };
}

// Atomically reserve the next invoice sequence number.
async function nextInvoiceSeq(): Promise<number> {
  if (sql) {
    const rows = await sql`UPDATE invoice_counter SET last_seq = last_seq + 1 WHERE id = ${INVOICE_PREFIX} RETURNING last_seq`;
    const arr = rows as any[];
    return arr.length ? Number(arr[0].last_seq) : INVOICE_START_SEQ;
  }
  const rows = readInvoices();
  const maxSeq = rows.reduce((m, i) => Math.max(m, i.seq), INVOICE_START_SEQ - 1);
  return maxSeq + 1;
}

// Pass a guestId to scope the list to that guest's own invoices; omit for the
// admin view (all invoices).
export async function getInvoices(ownerGuestId?: string): Promise<Invoice[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = ownerGuestId
        ? await sql`SELECT * FROM invoices WHERE owner_guest_id = ${ownerGuestId} ORDER BY seq DESC`
        : await sql`SELECT * FROM invoices ORDER BY seq DESC`;
      return (rows as any[]).map(rowToInvoice);
    })());
  }
  const all = readInvoices().sort((a, b) => b.seq - a.seq);
  return ownerGuestId ? all.filter(i => i.ownerGuestId === ownerGuestId) : all;
}

// Every invoice linked to a booking (linkage lives only on invoice.bookingIds —
// the booking derives its invoices, keeping one source of truth).
export async function getInvoicesForBooking(bookingId: string): Promise<Invoice[]> {
  const all = await getInvoices();
  return all.filter(i => i.bookingIds.includes(bookingId));
}

export async function getInvoiceById(id: string): Promise<Invoice | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToInvoice(arr[0]) : null;
  }
  return readInvoices().find(i => i.id === id) ?? null;
}

export async function getInvoiceByToken(token: string): Promise<Invoice | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM invoices WHERE token = ${token} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToInvoice(arr[0]) : null;
  }
  return readInvoices().find(i => i.token === token) ?? null;
}

// Used by the Square webhook to match an incoming payment back to the
// invoice whose payment link generated that order.
export async function getInvoiceBySquareOrderId(orderId: string): Promise<Invoice | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM invoices WHERE square_order_id = ${orderId} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToInvoice(arr[0]) : null;
  }
  return readInvoices().find(i => i.squareOrderId === orderId) ?? null;
}

export async function createInvoice(input: InvoiceInput): Promise<Invoice> {
  const now = new Date().toISOString();
  const items = (input.items ?? []).map(it => ({
    description: it.description ?? '',
    detail: it.detail ?? '',
    serviceAddress: it.serviceAddress ?? '',
    date: it.date ?? '',
    amount: Number(it.amount) || 0,
  }));
  const { subtotal, total } = computeTotals(items);

  // Linked bookings: merge the multi-link array with the legacy single id, dedupe.
  const bookingIds = Array.from(new Set(
    [...(input.bookingIds ?? []), ...(input.bookingId ? [input.bookingId] : [])].filter(Boolean),
  ));
  const bookingId = bookingIds[0] ?? null;

  if (sql) {
    await ensureSchema();
    const seq = await nextInvoiceSeq();
    const invoice: Invoice = {
      id: `INV-${Date.now()}`,
      number: `${INVOICE_PREFIX}${seq}`,
      seq,
      isTaxInvoice: !!input.isTaxInvoice,
      status: input.status ?? 'draft',
      paymentMethod: input.paymentMethod ?? null,
      fromName: input.fromName, fromTradingAs: input.fromTradingAs, fromAbn: input.fromAbn,
      fromAddress: input.fromAddress, fromEmail: input.fromEmail, fromPhone: input.fromPhone,
      showFromAddress: input.isTaxInvoice ? true : (input.showFromAddress ?? true),
      billToName: input.billToName ?? '', billToLines: input.billToLines ?? '',
      client: input.client ?? { show: false, clientName: '', trn: '', fileNo: '', claimRef: '' },
      invoiceDate: input.invoiceDate ?? '', serviceDate: input.serviceDate ?? '', dueDate: input.dueDate ?? '',
      items, subtotal, total,
      notes: input.notes ?? '',
      payAccountName: input.payAccountName ?? '', payBsb: input.payBsb ?? '', payAccountNumber: input.payAccountNumber ?? '',
      token: `inv_${crypto.randomBytes(12).toString('hex')}`,
      bookingId,
      bookingIds,
      ownerGuestId: input.ownerGuestId ?? null,
      createdAt: now, updatedAt: now, sentAt: null, paidAt: null,
      viewCount: 0, firstViewedAt: null, lastViewedAt: null,
      squarePaymentLinkUrl: null, squareOrderId: null, squarePaymentId: null, squareLinkAmount: null, squarePaidAt: null,
    };
    await sql`
      INSERT INTO invoices (
        id, number, seq, is_tax_invoice, status,
        from_name, from_trading_as, from_abn, from_address, from_email, from_phone, show_from_address,
        bill_to_name, bill_to_lines,
        client_show, client_name, client_trn, client_file_no, client_claim_ref,
        invoice_date, service_date, due_date,
        items, subtotal, total, notes,
        pay_account_name, pay_bsb, pay_account_number,
        token, booking_id, booking_ids, owner_guest_id, payment_method
      ) VALUES (
        ${invoice.id}, ${invoice.number}, ${invoice.seq}, ${invoice.isTaxInvoice}, ${invoice.status},
        ${invoice.fromName}, ${invoice.fromTradingAs}, ${invoice.fromAbn}, ${invoice.fromAddress}, ${invoice.fromEmail}, ${invoice.fromPhone}, ${invoice.showFromAddress},
        ${invoice.billToName}, ${invoice.billToLines},
        ${invoice.client.show}, ${invoice.client.clientName}, ${invoice.client.trn}, ${invoice.client.fileNo}, ${invoice.client.claimRef},
        ${invoice.invoiceDate}, ${invoice.serviceDate}, ${invoice.dueDate},
        ${JSON.stringify(invoice.items)}, ${invoice.subtotal}, ${invoice.total}, ${invoice.notes},
        ${invoice.payAccountName}, ${invoice.payBsb}, ${invoice.payAccountNumber},
        ${invoice.token}, ${invoice.bookingId}, ${JSON.stringify(invoice.bookingIds)}, ${invoice.ownerGuestId}, ${invoice.paymentMethod}
      )
    `;
    return invoice;
  }

  const rows = readInvoices();
  const seq = await nextInvoiceSeq();
  const invoice: Invoice = {
    id: `INV-${Date.now()}`,
    number: `${INVOICE_PREFIX}${seq}`,
    seq,
    isTaxInvoice: !!input.isTaxInvoice,
    status: input.status ?? 'draft',
    paymentMethod: input.paymentMethod ?? null,
    fromName: input.fromName, fromTradingAs: input.fromTradingAs, fromAbn: input.fromAbn,
    fromAddress: input.fromAddress, fromEmail: input.fromEmail, fromPhone: input.fromPhone,
    showFromAddress: input.isTaxInvoice ? true : (input.showFromAddress ?? true),
    billToName: input.billToName ?? '', billToLines: input.billToLines ?? '',
    client: input.client ?? { show: false, clientName: '', trn: '', fileNo: '', claimRef: '' },
    invoiceDate: input.invoiceDate ?? '', serviceDate: input.serviceDate ?? '', dueDate: input.dueDate ?? '',
    items, subtotal, total,
    notes: input.notes ?? '',
    payAccountName: input.payAccountName ?? '', payBsb: input.payBsb ?? '', payAccountNumber: input.payAccountNumber ?? '',
    token: `inv_${crypto.randomBytes(12).toString('hex')}`,
    bookingId,
    bookingIds,
    ownerGuestId: input.ownerGuestId ?? null,
    createdAt: now, updatedAt: now, sentAt: null, paidAt: null,
    viewCount: 0, firstViewedAt: null, lastViewedAt: null,
    squarePaymentLinkUrl: null, squareOrderId: null, squarePaymentId: null, squareLinkAmount: null, squarePaidAt: null,
  };
  rows.push(invoice);
  writeInvoices(rows);
  return invoice;
}

// LARP mode: inserts a fully pre-built Invoice — bypasses nextInvoiceSeq()
// entirely, so fake invoices can never consume or disturb the real GB####
// sequence. Fake `number`s live in a deliberately far-off range (see
// buildLarpInvoices in larp.ts) instead.
export async function insertRawInvoice(invoice: Invoice): Promise<void> {
  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO invoices (
        id, number, seq, is_tax_invoice, status, payment_method,
        from_name, from_trading_as, from_abn, from_address, from_email, from_phone, show_from_address,
        bill_to_name, bill_to_lines,
        client_show, client_name, client_trn, client_file_no, client_claim_ref,
        invoice_date, service_date, due_date,
        items, subtotal, total, notes,
        pay_account_name, pay_bsb, pay_account_number,
        token, booking_id, booking_ids, owner_guest_id,
        created_at, updated_at, sent_at, paid_at, view_count, first_viewed_at, last_viewed_at
      ) VALUES (
        ${invoice.id}, ${invoice.number}, ${invoice.seq}, ${invoice.isTaxInvoice}, ${invoice.status}, ${invoice.paymentMethod},
        ${invoice.fromName}, ${invoice.fromTradingAs}, ${invoice.fromAbn}, ${invoice.fromAddress}, ${invoice.fromEmail}, ${invoice.fromPhone}, ${invoice.showFromAddress},
        ${invoice.billToName}, ${invoice.billToLines},
        ${invoice.client.show}, ${invoice.client.clientName}, ${invoice.client.trn}, ${invoice.client.fileNo}, ${invoice.client.claimRef},
        ${invoice.invoiceDate}, ${invoice.serviceDate}, ${invoice.dueDate},
        ${JSON.stringify(invoice.items)}, ${invoice.subtotal}, ${invoice.total}, ${invoice.notes},
        ${invoice.payAccountName}, ${invoice.payBsb}, ${invoice.payAccountNumber},
        ${invoice.token}, ${invoice.bookingId}, ${JSON.stringify(invoice.bookingIds)}, ${invoice.ownerGuestId},
        ${invoice.createdAt}, ${invoice.updatedAt}, ${invoice.sentAt}, ${invoice.paidAt}, ${invoice.viewCount}, ${invoice.firstViewedAt}, ${invoice.lastViewedAt}
      )
    `;
    return;
  }
  const rows = readInvoices();
  rows.push(invoice);
  writeInvoices(rows);
}

export async function deleteInvoicesByIdPrefix(prefix: string): Promise<number> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM invoices WHERE id LIKE ${prefix + '%'} RETURNING id`;
    return (rows as any[]).length;
  }
  const rows = readInvoices();
  const kept = rows.filter(i => !i.id.startsWith(prefix));
  const removed = rows.length - kept.length;
  writeInvoices(kept);
  return removed;
}

// Stamp sentAt / paidAt the first time an invoice reaches that status, unless
// the caller passed an explicit value.
function withInvoiceStamps(cur: Invoice, updates: Partial<Invoice>): Partial<Invoice> {
  const out = { ...updates };
  if (!('sentAt' in updates) && updates.status === 'sent' && cur.status !== 'sent' && !cur.sentAt) {
    out.sentAt = new Date().toISOString();
  }
  if (!('paidAt' in updates) && updates.status === 'paid' && cur.status !== 'paid' && !cur.paidAt) {
    out.paidAt = new Date().toISOString();
  }
  // Un-marking paid (e.g. "Unmark paid") without specifying a new method
  // clears the stale one, so a later re-mark-paid doesn't inherit it.
  if (!('paymentMethod' in updates) && updates.status && updates.status !== 'paid' && cur.status === 'paid') {
    out.paymentMethod = null;
  }
  return out;
}

// Authoritative linked-booking set for an invoice update. If the caller passes
// bookingIds it wins outright (so unlinking works); otherwise merge the legacy
// single id in.
function resolveBookingIds(cur: Invoice, rawUpdates: Partial<Invoice>, mergedBookingId: string | null): string[] {
  if (Array.isArray(rawUpdates.bookingIds)) {
    return Array.from(new Set(rawUpdates.bookingIds.filter(Boolean)));
  }
  return Array.from(new Set([...(cur.bookingIds ?? []), ...(mergedBookingId ? [mergedBookingId] : [])].filter(Boolean)));
}

// When an invoice first becomes paid, flip every linked booking to paid too
// (one-way: invoice → booking). Best-effort; never throws.
async function syncInvoicePaidToBookings(cur: Invoice, updated: Invoice): Promise<void> {
  if (cur.status === 'paid' || updated.status !== 'paid') return;
  for (const bid of updated.bookingIds) {
    try {
      const b = await getBookingById(bid);
      if (b && !b.paid) await updateBooking(bid, { paid: true });
    } catch { /* best-effort */ }
  }
}

export async function updateInvoice(id: string, rawUpdates: Partial<Invoice>): Promise<Invoice | null> {
  if (sql) {
    await ensureSchema();
    const cur = await getInvoiceById(id);
    if (!cur) return null;
    const updates = withInvoiceStamps(cur, rawUpdates);
    const m = { ...cur, ...updates };
    // Never let the caller rewrite identity/number/seq/token.
    m.id = cur.id; m.number = cur.number; m.seq = cur.seq; m.token = cur.token;
    const totals = computeTotals(m.items);
    m.subtotal = totals.subtotal; m.total = totals.total;
    m.bookingIds = resolveBookingIds(cur, rawUpdates, m.bookingId);
    m.bookingId = m.bookingIds[0] ?? null;
    // A tax invoice always shows the business address — non-negotiable, so
    // this holds even if the caller sent conflicting fields.
    if (m.isTaxInvoice) m.showFromAddress = true;
    const rows = await sql`
      UPDATE invoices SET
        is_tax_invoice = ${m.isTaxInvoice},
        status = ${m.status},
        from_name = ${m.fromName}, from_trading_as = ${m.fromTradingAs}, from_abn = ${m.fromAbn},
        from_address = ${m.fromAddress}, from_email = ${m.fromEmail}, from_phone = ${m.fromPhone},
        show_from_address = ${m.showFromAddress},
        bill_to_name = ${m.billToName}, bill_to_lines = ${m.billToLines},
        client_show = ${m.client.show}, client_name = ${m.client.clientName}, client_trn = ${m.client.trn},
        client_file_no = ${m.client.fileNo}, client_claim_ref = ${m.client.claimRef},
        invoice_date = ${m.invoiceDate}, service_date = ${m.serviceDate}, due_date = ${m.dueDate},
        items = ${JSON.stringify(m.items)}, subtotal = ${m.subtotal}, total = ${m.total}, notes = ${m.notes},
        pay_account_name = ${m.payAccountName}, pay_bsb = ${m.payBsb}, pay_account_number = ${m.payAccountNumber},
        booking_id = ${m.bookingId},
        booking_ids = ${JSON.stringify(m.bookingIds)},
        sent_at = ${m.sentAt ?? null}, paid_at = ${m.paidAt ?? null},
        payment_method = ${m.paymentMethod ?? null},
        square_payment_link_url = ${m.squarePaymentLinkUrl ?? null},
        square_order_id = ${m.squareOrderId ?? null},
        square_payment_id = ${m.squarePaymentId ?? null},
        square_link_amount = ${m.squareLinkAmount ?? null},
        square_paid_at = ${m.squarePaidAt ?? null},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    const arr = rows as any[];
    const updated = arr.length ? rowToInvoice(arr[0]) : null;
    if (updated) await syncInvoicePaidToBookings(cur, updated);
    return updated;
  }

  const rows = readInvoices();
  const idx = rows.findIndex(i => i.id === id);
  if (idx === -1) return null;
  const updates = withInvoiceStamps(rows[idx], rawUpdates);
  const cur = rows[idx];
  const m = { ...cur, ...updates };
  m.id = cur.id; m.number = cur.number; m.seq = cur.seq; m.token = cur.token;
  const totals = computeTotals(m.items);
  m.subtotal = totals.subtotal; m.total = totals.total;
  m.bookingIds = resolveBookingIds(cur, rawUpdates, m.bookingId);
  m.bookingId = m.bookingIds[0] ?? null;
  if (m.isTaxInvoice) m.showFromAddress = true;
  m.updatedAt = new Date().toISOString();
  rows[idx] = m;
  writeInvoices(rows);
  await syncInvoicePaidToBookings(cur, m);
  return rows[idx];
}

export async function deleteInvoice(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM invoices WHERE id = ${id} RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const rows = readInvoices();
  const filtered = rows.filter(i => i.id !== id);
  if (filtered.length === rows.length) return false;
  writeInvoices(filtered);
  return true;
}

// Record a customer view of the public invoice link. Stamps the first view and
// bumps the counter. Callers must exclude logged-in admins before calling this.
export async function recordInvoiceView(token: string): Promise<Invoice | null> {
  const now = new Date().toISOString();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      UPDATE invoices SET
        view_count = view_count + 1,
        first_viewed_at = COALESCE(first_viewed_at, ${now}),
        last_viewed_at = ${now}
      WHERE token = ${token}
      RETURNING *
    `;
    const arr = rows as any[];
    return arr.length ? rowToInvoice(arr[0]) : null;
  }
  const rows = readInvoices();
  const idx = rows.findIndex(i => i.token === token);
  if (idx === -1) return null;
  rows[idx].viewCount = (rows[idx].viewCount ?? 0) + 1;
  rows[idx].firstViewedAt = rows[idx].firstViewedAt ?? now;
  rows[idx].lastViewedAt = now;
  writeInvoices(rows);
  return rows[idx];
}

// ─── Payment profiles ────────────────────────────────────────────────────────

function readPaymentProfiles(): PaymentProfile[] {
  try {
    if (!fs.existsSync(PAYMENT_PROFILE_PATH)) {
      const dir = path.dirname(PAYMENT_PROFILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(PAYMENT_PROFILE_PATH, JSON.stringify(SEED_PAYMENT_PROFILES, null, 2));
      return [...SEED_PAYMENT_PROFILES];
    }
    return JSON.parse(fs.readFileSync(PAYMENT_PROFILE_PATH, 'utf-8'));
  } catch { return [...SEED_PAYMENT_PROFILES]; }
}
function writePaymentProfiles(rows: PaymentProfile[]): void {
  const dir = path.dirname(PAYMENT_PROFILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PAYMENT_PROFILE_PATH, JSON.stringify(rows, null, 2));
}

function rowToProfile(r: any): PaymentProfile {
  return {
    id: r.id,
    name: r.name,
    accountName: r.account_name ?? '',
    bsb: r.bsb ?? '',
    accountNumber: r.account_number ?? '',
    sort: Number(r.sort ?? 0),
    builtin: r.builtin === true || r.builtin === 1,
  };
}

export async function getPaymentProfiles(): Promise<PaymentProfile[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM payment_profiles ORDER BY sort ASC, created_at ASC`;
      return (rows as any[]).map(rowToProfile);
    })());
  }
  return readPaymentProfiles().sort((a, b) => a.sort - b.sort);
}

export async function addPaymentProfile(data: { name: string; accountName: string; bsb: string; accountNumber: string }): Promise<PaymentProfile> {
  if (sql) {
    await ensureSchema();
    const maxRows = await sql`SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM payment_profiles`;
    const sort = Number((maxRows as any[])[0]?.next ?? 1);
    const profile: PaymentProfile = {
      id: `PP-${Date.now()}`, name: data.name, accountName: data.accountName,
      bsb: data.bsb, accountNumber: data.accountNumber, sort, builtin: false,
    };
    await sql`
      INSERT INTO payment_profiles (id, name, account_name, bsb, account_number, sort, builtin)
      VALUES (${profile.id}, ${profile.name}, ${profile.accountName}, ${profile.bsb}, ${profile.accountNumber}, ${profile.sort}, false)
    `;
    return profile;
  }
  const rows = readPaymentProfiles();
  const sort = rows.reduce((m, p) => Math.max(m, p.sort), 0) + 1;
  const profile: PaymentProfile = {
    id: `PP-${Date.now()}`, name: data.name, accountName: data.accountName,
    bsb: data.bsb, accountNumber: data.accountNumber, sort, builtin: false,
  };
  rows.push(profile);
  writePaymentProfiles(rows);
  return profile;
}

function readBusinessProfiles(): BusinessProfile[] {
  try {
    if (!fs.existsSync(BUSINESS_PROFILE_PATH)) {
      const dir = path.dirname(BUSINESS_PROFILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(BUSINESS_PROFILE_PATH, JSON.stringify(SEED_BUSINESS_PROFILES, null, 2));
      return [...SEED_BUSINESS_PROFILES];
    }
    return JSON.parse(fs.readFileSync(BUSINESS_PROFILE_PATH, 'utf-8'));
  } catch { return [...SEED_BUSINESS_PROFILES]; }
}
function writeBusinessProfiles(rows: BusinessProfile[]): void {
  const dir = path.dirname(BUSINESS_PROFILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(BUSINESS_PROFILE_PATH, JSON.stringify(rows, null, 2));
}

function rowToBusinessProfile(r: any): BusinessProfile {
  return {
    id: r.id,
    name: r.name,
    fromName: r.from_name ?? '',
    fromTradingAs: r.from_trading_as ?? '',
    fromAbn: r.from_abn ?? '',
    fromAddress: r.from_address ?? '',
    fromEmail: r.from_email ?? '',
    fromPhone: r.from_phone ?? '',
    sort: Number(r.sort ?? 0),
    builtin: r.builtin === true || r.builtin === 1,
  };
}

export async function getBusinessProfiles(): Promise<BusinessProfile[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM business_profiles ORDER BY sort ASC, created_at ASC`;
      return (rows as any[]).map(rowToBusinessProfile);
    })());
  }
  return readBusinessProfiles().sort((a, b) => a.sort - b.sort);
}

export async function addBusinessProfile(data: {
  name: string; fromName: string; fromTradingAs: string; fromAbn: string; fromAddress: string; fromEmail: string; fromPhone: string;
}): Promise<BusinessProfile> {
  if (sql) {
    await ensureSchema();
    const maxRows = await sql`SELECT COALESCE(MAX(sort), 0) + 1 AS next FROM business_profiles`;
    const sort = Number((maxRows as any[])[0]?.next ?? 1);
    const profile: BusinessProfile = { id: `BP-${Date.now()}`, sort, builtin: false, ...data };
    await sql`
      INSERT INTO business_profiles (id, name, from_name, from_trading_as, from_abn, from_address, from_email, from_phone, sort, builtin)
      VALUES (${profile.id}, ${profile.name}, ${profile.fromName}, ${profile.fromTradingAs}, ${profile.fromAbn}, ${profile.fromAddress}, ${profile.fromEmail}, ${profile.fromPhone}, ${profile.sort}, false)
    `;
    return profile;
  }
  const rows = readBusinessProfiles();
  const sort = rows.reduce((m, p) => Math.max(m, p.sort), 0) + 1;
  const profile: BusinessProfile = { id: `BP-${Date.now()}`, sort, builtin: false, ...data };
  rows.push(profile);
  writeBusinessProfiles(rows);
  return profile;
}

// Editing is allowed on any profile, built-in included — only deletion is
// restricted, so the seeded identity can be corrected but not removed.
export async function updateBusinessProfile(id: string, data: Partial<Omit<BusinessProfile, 'id' | 'sort' | 'builtin'>>): Promise<BusinessProfile | null> {
  if (sql) {
    await ensureSchema();
    const cur = (await sql`SELECT * FROM business_profiles WHERE id = ${id} LIMIT 1`) as any[];
    if (!cur.length) return null;
    const m = { ...rowToBusinessProfile(cur[0]), ...data };
    await sql`
      UPDATE business_profiles SET
        name = ${m.name}, from_name = ${m.fromName}, from_trading_as = ${m.fromTradingAs}, from_abn = ${m.fromAbn},
        from_address = ${m.fromAddress}, from_email = ${m.fromEmail}, from_phone = ${m.fromPhone}
      WHERE id = ${id}
    `;
    return m;
  }
  const rows = readBusinessProfiles();
  const idx = rows.findIndex(p => p.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...data };
  writeBusinessProfiles(rows);
  return rows[idx];
}

export async function deleteBusinessProfile(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM business_profiles WHERE id = ${id} AND builtin = false RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const rows = readBusinessProfiles();
  const target = rows.find(p => p.id === id);
  if (!target || target.builtin) return false;
  writeBusinessProfiles(rows.filter(p => p.id !== id));
  return true;
}

// ─── App settings (singleton) ───────────────────────────────────────────────
// Projects the stored blob through only the keys AppSettings currently
// defines: a field added later just fills in from DEFAULT_SETTINGS (no
// migration needed), and a field removed from the type stops appearing even
// if an old stored row/file still has it lying around.
function projectSettings(stored: Record<string, unknown> | null | undefined): AppSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (stored) {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      if (key in stored) (out as any)[key] = stored[key];
    }
  }
  return out;
}

function readSettingsFile(): AppSettings {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      const dir = path.dirname(SETTINGS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
      return { ...DEFAULT_SETTINGS };
    }
    const stored = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    return projectSettings(stored);
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettingsFile(s: AppSettings): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

export async function getSettings(): Promise<AppSettings> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT data FROM app_settings WHERE id = 'global' LIMIT 1`;
      const arr = rows as any[];
      if (!arr.length) return { ...DEFAULT_SETTINGS };
      try { return projectSettings(JSON.parse(arr[0].data)); }
      catch { return { ...DEFAULT_SETTINGS }; }
    })());
  }
  return readSettingsFile();
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  const cur = await getSettings();
  const updated: AppSettings = { ...cur, ...partial };
  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO app_settings (id, data, updated_at) VALUES ('global', ${JSON.stringify(updated)}, now())
      ON CONFLICT (id) DO UPDATE SET data = ${JSON.stringify(updated)}, updated_at = now()
    `;
    return updated;
  }
  writeSettingsFile(updated);
  return updated;
}

// ─── Activity log (site-wide events) ────────────────────────────────────────

function readActivityLog(): ActivityEntry[] {
  try {
    if (!fs.existsSync(ACTIVITY_PATH)) return [];
    return JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf-8'));
  } catch { return []; }
}
function writeActivityLog(rows: ActivityEntry[]): void {
  const dir = path.dirname(ACTIVITY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(rows, null, 2));
}

// Best-effort — never throws, never blocks the caller's response on failure.
// `actor` is a free-form label: 'admin' | 'guest:<id>' | 'customer' | 'system'.
export async function logActivity(
  type: string,
  summary: string,
  meta: Record<string, unknown> | null = null,
  actor: string = 'system',
  invoiceId: string | null = null,
): Promise<void> {
  const entry: ActivityEntry = {
    id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type, summary, meta, actor, invoiceId,
    createdAt: new Date().toISOString(),
  };
  try {
    if (sql) {
      await ensureSchema();
      await sql`
        INSERT INTO activity_log (id, type, summary, meta, actor, invoice_id)
        VALUES (${entry.id}, ${entry.type}, ${entry.summary}, ${JSON.stringify(entry.meta)}, ${entry.actor}, ${entry.invoiceId})
      `;
      return;
    }
    const rows = readActivityLog();
    rows.unshift(entry);
    writeActivityLog(rows.slice(0, ACTIVITY_MAX_ROWS));
  } catch (err) {
    console.error('logActivity failed:', err);
  }
}

function rowToActivity(r: any): ActivityEntry {
  let meta: Record<string, unknown> | null = null;
  try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { meta = null; }
  return {
    id: r.id, type: r.type, summary: r.summary, meta, actor: r.actor,
    invoiceId: r.invoice_id ?? null,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  };
}

export async function getActivityLog(limit = 200, invoiceId?: string): Promise<ActivityEntry[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = invoiceId
        ? await sql`SELECT * FROM activity_log WHERE invoice_id = ${invoiceId} ORDER BY created_at DESC LIMIT ${limit}`
        : await sql`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ${limit}`;
      return (rows as any[]).map(rowToActivity);
    })());
  }
  const rows = readActivityLog();
  const filtered = invoiceId ? rows.filter(r => r.invoiceId === invoiceId) : rows;
  return filtered.slice(0, limit);
}

// ─── Invoice view sessions (per-open detail log) ────────────────────────────

function readInvoiceViews(): InvoiceViewSession[] {
  try {
    if (!fs.existsSync(INVOICE_VIEWS_PATH)) return [];
    return JSON.parse(fs.readFileSync(INVOICE_VIEWS_PATH, 'utf-8'));
  } catch { return []; }
}
function writeInvoiceViews(rows: InvoiceViewSession[]): void {
  const dir = path.dirname(INVOICE_VIEWS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(INVOICE_VIEWS_PATH, JSON.stringify(rows, null, 2));
}

export async function createInvoiceViewSession(invoiceId: string, info: {
  ip: string; deviceType: string; browser: string; city: string | null; region: string | null; country: string | null;
}): Promise<string> {
  const id = `IVW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  try {
    if (sql) {
      await ensureSchema();
      await sql`
        INSERT INTO invoice_views (id, invoice_id, ip, device_type, browser, city, region, country, started_at)
        VALUES (${id}, ${invoiceId}, ${info.ip}, ${info.deviceType}, ${info.browser}, ${info.city}, ${info.region}, ${info.country}, ${now})
      `;
      return id;
    }
    const rows = readInvoiceViews();
    rows.unshift({
      id, invoiceId, ip: info.ip, deviceType: info.deviceType, browser: info.browser,
      city: info.city, region: info.region, country: info.country,
      startedAt: now, endedAt: null, durationSeconds: null,
    });
    writeInvoiceViews(rows.slice(0, ACTIVITY_MAX_ROWS));
    return id;
  } catch (err) {
    console.error('createInvoiceViewSession failed:', err);
    return id; // still return an id — ending a session that failed to write is harmless
  }
}

export async function endInvoiceViewSession(id: string): Promise<void> {
  try {
    if (sql) {
      await ensureSchema();
      await sql`
        UPDATE invoice_views SET ended_at = now(),
          duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
        WHERE id = ${id} AND ended_at IS NULL
      `;
      return;
    }
    const rows = readInvoiceViews();
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1 || rows[idx].endedAt) return;
    const endedAt = new Date();
    const startedAt = new Date(rows[idx].startedAt);
    rows[idx].endedAt = endedAt.toISOString();
    rows[idx].durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    writeInvoiceViews(rows);
  } catch (err) {
    console.error('endInvoiceViewSession failed:', err);
  }
}

export async function getInvoiceViewSessions(invoiceId: string): Promise<InvoiceViewSession[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM invoice_views WHERE invoice_id = ${invoiceId} ORDER BY started_at DESC`;
      return (rows as any[]).map(r => ({
        id: r.id, invoiceId: r.invoice_id, ip: r.ip, deviceType: r.device_type, browser: r.browser,
        city: r.city ?? null, region: r.region ?? null, country: r.country ?? null,
        startedAt: typeof r.started_at === 'string' ? r.started_at : new Date(r.started_at).toISOString(),
        endedAt: r.ended_at == null ? null : (typeof r.ended_at === 'string' ? r.ended_at : new Date(r.ended_at).toISOString()),
        durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
      }));
    })());
  }
  return readInvoiceViews().filter(r => r.invoiceId === invoiceId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

// ─── Guests (subcontractor logins) ──────────────────────────────────────────

function readGuests(): Guest[] {
  try {
    if (!fs.existsSync(GUEST_PATH)) return [];
    return JSON.parse(fs.readFileSync(GUEST_PATH, 'utf-8'));
  } catch { return []; }
}
function writeGuests(rows: Guest[]): void {
  const dir = path.dirname(GUEST_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GUEST_PATH, JSON.stringify(rows, null, 2));
}

function rowToGuest(r: any): Guest {
  return {
    id: r.id,
    name: r.name,
    passwordHash: r.password_hash,
    active: r.active === true || r.active === 1,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  };
}

export async function getGuests(): Promise<Guest[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM guests ORDER BY created_at ASC`;
      return (rows as any[]).map(rowToGuest);
    })());
  }
  return readGuests();
}

export async function getGuestById(id: string): Promise<Guest | null> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`SELECT * FROM guests WHERE id = ${id} LIMIT 1`;
    const arr = rows as any[];
    return arr.length ? rowToGuest(arr[0]) : null;
  }
  return readGuests().find(g => g.id === id) ?? null;
}

export async function addGuest(data: NewGuest): Promise<Guest> {
  const guest: Guest = {
    id: `GST-${Date.now()}`,
    name: data.name,
    passwordHash: data.passwordHash,
    active: data.active ?? true,
    createdAt: new Date().toISOString(),
  };
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO guests (id, name, password_hash, active) VALUES (${guest.id}, ${guest.name}, ${guest.passwordHash}, ${guest.active})`;
    return guest;
  }
  const rows = readGuests();
  rows.push(guest);
  writeGuests(rows);
  return guest;
}

export async function updateGuest(id: string, updates: Partial<Pick<Guest, 'name' | 'active' | 'passwordHash'>>): Promise<Guest | null> {
  if (sql) {
    await ensureSchema();
    const cur = await getGuestById(id);
    if (!cur) return null;
    const m = { ...cur, ...updates };
    const rows = await sql`
      UPDATE guests SET name = ${m.name}, password_hash = ${m.passwordHash}, active = ${m.active}
      WHERE id = ${id} RETURNING *
    `;
    const arr = rows as any[];
    return arr.length ? rowToGuest(arr[0]) : null;
  }
  const rows = readGuests();
  const idx = rows.findIndex(g => g.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...updates };
  writeGuests(rows);
  return rows[idx];
}

// Deleting a guest unassigns their jobs (jobs are never deleted with the guest).
export async function deleteGuest(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    await sql`UPDATE bookings SET assigned_guest_id = NULL, assigned_at = NULL WHERE assigned_guest_id = ${id}`;
    const rows = await sql`DELETE FROM guests WHERE id = ${id} RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const guests = readGuests();
  const filtered = guests.filter(g => g.id !== id);
  if (filtered.length === guests.length) return false;
  writeGuests(filtered);
  const bookings = readFile();
  let touched = false;
  bookings.forEach(b => {
    if (b.assignedGuestId === id) { b.assignedGuestId = null; b.assignedAt = null; touched = true; }
  });
  if (touched) writeFile(bookings);
  return true;
}

// ─── Bulk booking actions ───────────────────────────────────────────────────

export async function bulkUpdateBookingStatus(ids: string[], status: BookingStatus): Promise<number> {
  let n = 0;
  for (const id of ids) { if (await updateBooking(id, { status })) n++; }
  return n;
}

export async function bulkDeleteBookings(ids: string[]): Promise<number> {
  let n = 0;
  for (const id of ids) { if (await deleteBooking(id)) n++; }
  return n;
}

// ─── Booking groups ─────────────────────────────────────────────────────────

export interface BookingGroup {
  id: string;
  title: string;
  createdAt: string;
  jobCount: number;   // computed
  totalValue: number; // computed (sum of quoteAmount)
}

function readGroups(): { id: string; title: string; createdAt: string }[] {
  try {
    if (!fs.existsSync(GROUP_PATH)) return [];
    return JSON.parse(fs.readFileSync(GROUP_PATH, 'utf-8'));
  } catch { return []; }
}
function writeGroups(rows: { id: string; title: string; createdAt: string }[]): void {
  const dir = path.dirname(GROUP_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(GROUP_PATH, JSON.stringify(rows, null, 2));
}

// Groups with live job count + total value (from their member bookings).
export async function getBookingGroups(): Promise<BookingGroup[]> {
  const bookings = await getBookings();
  const tally = (id: string) => {
    const members = bookings.filter(b => b.groupId === id);
    return { jobCount: members.length, totalValue: members.reduce((s, b) => s + (b.quoteAmount ?? 0), 0) };
  };
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM booking_groups ORDER BY created_at DESC`;
      return (rows as any[]).map(r => ({
        id: r.id, title: r.title ?? '',
        createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
        ...tally(r.id),
      }));
    })());
  }
  return readGroups()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(g => ({ ...g, ...tally(g.id) }));
}

export async function createBookingGroup(title: string, bookingIds: string[]): Promise<BookingGroup> {
  const id = `GRP-${Date.now()}`;
  const createdAt = new Date().toISOString();
  if (sql) {
    await ensureSchema();
    await sql`INSERT INTO booking_groups (id, title) VALUES (${id}, ${title})`;
    for (const bid of bookingIds) await sql`UPDATE bookings SET group_id = ${id}, updated_at = now() WHERE id = ${bid}`;
  } else {
    const rows = readGroups();
    rows.push({ id, title, createdAt });
    writeGroups(rows);
    const bks = readFile();
    bks.forEach(b => { if (bookingIds.includes(b.id)) b.groupId = id; });
    writeFile(bks);
  }
  const groups = await getBookingGroups();
  return groups.find(g => g.id === id) ?? { id, title, createdAt, jobCount: 0, totalValue: 0 };
}

// Delete a group only — its bookings survive (group_id cleared).
export async function deleteBookingGroup(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    await sql`UPDATE bookings SET group_id = NULL, updated_at = now() WHERE group_id = ${id}`;
    const rows = await sql`DELETE FROM booking_groups WHERE id = ${id} RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const groups = readGroups();
  const filtered = groups.filter(g => g.id !== id);
  if (filtered.length === groups.length) return false;
  writeGroups(filtered);
  const bks = readFile();
  bks.forEach(b => { if (b.groupId === id) b.groupId = null; });
  writeFile(bks);
  return true;
}

// Delete a group AND every booking inside it (destructive — confirmed in the UI).
export async function deleteBookingGroupWithBookings(id: string): Promise<{ ok: boolean; deletedBookings: number }> {
  if (sql) {
    await ensureSchema();
    const del = await sql`DELETE FROM bookings WHERE group_id = ${id} RETURNING id`;
    const rows = await sql`DELETE FROM booking_groups WHERE id = ${id} RETURNING id`;
    return { ok: (rows as any[]).length > 0, deletedBookings: (del as any[]).length };
  }
  const groups = readGroups();
  const filtered = groups.filter(g => g.id !== id);
  if (filtered.length === groups.length) return { ok: false, deletedBookings: 0 };
  const bks = readFile();
  const remaining = bks.filter(b => b.groupId !== id);
  const deletedBookings = bks.length - remaining.length;
  writeFile(remaining);
  writeGroups(filtered);
  return { ok: true, deletedBookings };
}

// Jobs sent to a particular guest (their whole dashboard).
export async function getBookingsForGuest(guestId: string): Promise<Booking[]> {
  if (sql) {
    return withTimeout((async () => {
      await ensureSchema();
      const rows = await sql`SELECT * FROM bookings WHERE assigned_guest_id = ${guestId} ORDER BY created_at DESC`;
      return (rows as any[]).map(rowToBooking);
    })());
  }
  return readFile().filter(b => b.assignedGuestId === guestId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Editing is allowed on any profile, built-in included — only deletion is
// restricted, so the seeded identity can be corrected but not removed.
export async function updatePaymentProfile(id: string, data: Partial<Omit<PaymentProfile, 'id' | 'sort' | 'builtin'>>): Promise<PaymentProfile | null> {
  if (sql) {
    await ensureSchema();
    const cur = (await sql`SELECT * FROM payment_profiles WHERE id = ${id} LIMIT 1`) as any[];
    if (!cur.length) return null;
    const m = { ...rowToProfile(cur[0]), ...data };
    await sql`
      UPDATE payment_profiles SET name = ${m.name}, account_name = ${m.accountName}, bsb = ${m.bsb}, account_number = ${m.accountNumber}
      WHERE id = ${id}
    `;
    return m;
  }
  const rows = readPaymentProfiles();
  const idx = rows.findIndex(p => p.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...data };
  writePaymentProfiles(rows);
  return rows[idx];
}

// Built-in profiles can't be deleted.
export async function deletePaymentProfile(id: string): Promise<boolean> {
  if (sql) {
    await ensureSchema();
    const rows = await sql`DELETE FROM payment_profiles WHERE id = ${id} AND builtin = false RETURNING id`;
    return (rows as any[]).length > 0;
  }
  const rows = readPaymentProfiles();
  const target = rows.find(p => p.id === id);
  if (!target || target.builtin) return false;
  writePaymentProfiles(rows.filter(p => p.id !== id));
  return true;
}
