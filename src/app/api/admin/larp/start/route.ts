import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { insertRawBooking, insertRawInvoice, insertRawRecurringJob, updateSettings, logActivity } from '@/lib/db';
import { buildLarpBookings, buildLarpInvoices, buildLarpRecurringPlans, LARP_MIN_REVENUE, LARP_MAX_REVENUE } from '@/lib/larp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CHUNK = 25; // concurrent inserts per batch — keeps this well inside a serverless timeout

async function insertAll<T>(rows: T[], insert: (row: T) => Promise<void>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await Promise.all(rows.slice(i, i + CHUNK).map(insert));
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const target = Math.max(LARP_MIN_REVENUE, Math.min(LARP_MAX_REVENUE, Number(b.revenueTarget) || LARP_MIN_REVENUE));

  const bookings = buildLarpBookings(target);
  const invoices = buildLarpInvoices(bookings);
  const recurring = buildLarpRecurringPlans();

  await insertAll(bookings, insertRawBooking);
  await insertAll(invoices, insertRawInvoice);
  await insertAll(recurring, insertRawRecurringJob);

  await updateSettings({ larpModeActive: true, larpRevenueTarget: target });
  await logActivity(
    'larp.started',
    `LARP mode on — ${bookings.length} fake jobs, ${invoices.length} fake invoices, ${recurring.length} fake recurring plans (~$${target.toLocaleString('en-AU')} target)`,
    { bookings: bookings.length, invoices: invoices.length, recurring: recurring.length, target },
    'admin',
  );

  return NextResponse.json({ bookings: bookings.length, invoices: invoices.length, recurring: recurring.length });
}
