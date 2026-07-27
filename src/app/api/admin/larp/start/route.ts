import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { insertRawBooking, insertRawInvoice, insertRawRecurringJob, insertRawPageView, updateSettings, logActivity } from '@/lib/db';
import { buildLarpBookings, buildLarpInvoices, buildLarpRecurringPlans, buildLarpPageViews, LARP_MIN_REVENUE, LARP_MAX_REVENUE } from '@/lib/larp';

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

  // Each category defaults on — an old client that doesn't send these still
  // gets the original "generate everything" behavior.
  const fakeNumbers = b.fakeNumbers !== false;
  const fakeBookings = b.fakeBookings !== false;
  const fakeColdLeads = b.fakeColdLeads !== false;
  const fakeInvoices = b.fakeInvoices !== false;
  const fakeCalendar = b.fakeCalendar !== false;

  // Invoices/cold-leads/calendar/recurring-plans are all sub-behaviors of the
  // bookings themselves — nothing to generate for any of them without bookings.
  const bookings = fakeBookings ? buildLarpBookings(target, { fakeColdLeads, fakeCalendar }) : [];
  const invoices = fakeBookings && fakeInvoices ? buildLarpInvoices(bookings) : [];
  const recurring = fakeBookings ? buildLarpRecurringPlans() : [];
  const pageViews = fakeNumbers ? buildLarpPageViews(target) : [];

  await insertAll(bookings, insertRawBooking);
  await insertAll(invoices, insertRawInvoice);
  await insertAll(recurring, insertRawRecurringJob);
  await insertAll(pageViews, insertRawPageView);

  await updateSettings({
    larpModeActive: true, larpRevenueTarget: target,
    larpFakeNumbers: fakeNumbers, larpFakeBookings: fakeBookings, larpFakeColdLeads: fakeColdLeads,
    larpFakeInvoices: fakeInvoices, larpFakeCalendar: fakeCalendar,
  });
  await logActivity(
    'larp.started',
    `LARP mode on — ${bookings.length} fake jobs, ${invoices.length} fake invoices, ${recurring.length} fake recurring plans, ${pageViews.length} fake page views (~$${target.toLocaleString('en-AU')} target)`,
    { bookings: bookings.length, invoices: invoices.length, recurring: recurring.length, pageViews: pageViews.length, target },
    'admin',
  );

  return NextResponse.json({ bookings: bookings.length, invoices: invoices.length, recurring: recurring.length, pageViews: pageViews.length });
}
