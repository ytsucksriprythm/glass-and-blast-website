import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

const DB_PATH = path.join(process.cwd(), 'data', 'bookings.json');

export type BookingStatus = 'pending' | 'quoted' | 'confirmed' | 'completed' | 'cancelled';
export type ServiceType = 'window-washing' | 'pressure-washing' | 'both';
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
  createdAt: string;
  updatedAt: string;
}

export type NewBooking = Omit<Booking, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'source' | 'paid'> & {
  status?: BookingStatus;
  source?: BookingSource;
  paid?: boolean;
};

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
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : new Date(r.updated_at).toISOString(),
  };
}

let schemaReady: Promise<void> | null = null;
async function ensureSchema(): Promise<void> {
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
    id: `BK-${Date.now()}`,
    status: data.status ?? 'pending',
    source: data.source ?? 'website',
    createdAt: now,
    updatedAt: now,
  };

  if (sql) {
    await ensureSchema();
    await sql`
      INSERT INTO bookings (id, name, email, phone, service, property_type, address, suburb, preferred_date, preferred_time, notes, status, quote_amount, admin_notes, paid, source)
      VALUES (${booking.id}, ${booking.name}, ${booking.email}, ${booking.phone}, ${booking.service}, ${booking.propertyType}, ${booking.address}, ${booking.suburb}, ${booking.preferredDate}, ${booking.preferredTime}, ${booking.notes}, ${booking.status}, ${booking.quoteAmount}, ${booking.adminNotes}, ${booking.paid}, ${booking.source})
    `;
    return booking;
  }

  const rows = readFile();
  rows.push(booking);
  writeFile(rows);
  return booking;
}

export async function updateBooking(id: string, updates: Partial<Booking>): Promise<Booking | null> {
  if (sql) {
    await ensureSchema();
    const cur = await getBookingById(id);
    if (!cur) return null;
    const m = { ...cur, ...updates };
    const rows = await sql`
      UPDATE bookings SET
        status = ${m.status},
        quote_amount = ${m.quoteAmount ?? null},
        admin_notes = ${m.adminNotes ?? ''},
        paid = ${m.paid ?? false},
        notes = ${m.notes ?? ''},
        preferred_date = ${m.preferredDate ?? ''},
        preferred_time = ${m.preferredTime ?? ''},
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
  rows[idx] = { ...rows[idx], ...updates, updatedAt: new Date().toISOString() };
  writeFile(rows);
  return rows[idx];
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

  const serviceBreakdown = {
    'Window Washing': bookings.filter(b => b.service === 'window-washing').length,
    'Pressure Washing': bookings.filter(b => b.service === 'pressure-washing').length,
    'Both Services': bookings.filter(b => b.service === 'both').length,
  };

  const statusBreakdown = {
    pending: bookings.filter(b => b.status === 'pending').length,
    quoted: bookings.filter(b => b.status === 'quoted').length,
    confirmed: bookings.filter(b => b.status === 'confirmed').length,
    completed: bookings.filter(b => b.status === 'completed').length,
    cancelled: bookings.filter(b => b.status === 'cancelled').length,
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
