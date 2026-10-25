import { NextRequest, NextResponse } from 'next/server';
import { getRecurringJobs, addRecurringJob, createProfileFromBooking, type RecurringFrequency, type IntervalUnit } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { ensureAllPortals } from '@/lib/portal';

export const dynamic = 'force-dynamic';

const FREQUENCIES: RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'biannual', 'custom'];
const UNITS: IntervalUnit[] = ['weeks', 'months', 'years'];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Shared by both create paths: the timeframe picker (a website tier, or
// custom "every N weeks/months/years") and its per-visit discount.
function parsePlan(body: any): { error: string } | {
  frequency: RecurringFrequency; customInterval: number | null; customIntervalUnit: IntervalUnit; discount: number | null;
} {
  const frequency = body.frequency as RecurringFrequency;
  if (!FREQUENCIES.includes(frequency)) return { error: 'Pick how often' };
  const customIntervalUnit: IntervalUnit = UNITS.includes(body.customIntervalUnit) ? body.customIntervalUnit : 'weeks';
  const customInterval = num(body.customInterval);
  if (frequency === 'custom' && (!customInterval || customInterval < 1 || !Number.isInteger(customInterval))) {
    return { error: 'Custom timeframe needs a whole number (1 or more)' };
  }
  const discount = num(body.discount);
  return { frequency, customInterval: frequency === 'custom' ? customInterval : null, customIntervalUnit, discount: discount && discount > 0 ? discount : null };
}

export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Older profiles get their portal link + PIN the first time they're listed.
  const jobs = await ensureAllPortals(await getRecurringJobs());
  return NextResponse.json(jobs);
}

// POST { fromBookingId, frequency, ... } → "Make recurring customer" from a job.
// POST { name, service, nextDate, frequency, ... } → a profile typed in by hand.
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const plan = parsePlan(body);
    if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 });

    if (typeof body.fromBookingId === 'string' && body.fromBookingId) {
      const result = await createProfileFromBooking(body.fromBookingId, { ...plan, visitPrice: num(body.visitPrice) });
      if (!result) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      return NextResponse.json(result, { status: 201 });
    }

    const { name, service, nextDate } = body;
    if (!name || !service || !nextDate) {
      return NextResponse.json({ error: 'Name, service and next visit date are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      return NextResponse.json({ error: 'Next date must be YYYY-MM-DD' }, { status: 400 });
    }
    const billingCycle = ['per_visit', 'monthly', 'custom'].includes(body.billingCycle) ? body.billingCycle : 'per_visit';
    const customBillingCycle = typeof body.customBillingCycle === 'string' ? body.customBillingCycle.trim() : '';
    if (billingCycle === 'custom' && !customBillingCycle) {
      return NextResponse.json({ error: 'Describe the custom billing cycle' }, { status: 400 });
    }
    const job = await addRecurringJob({
      name,
      service,
      ...plan,
      nextDate,
      phone: body.phone ?? '',
      email: body.email ?? '',
      address: body.address ?? '',
      suburb: body.suburb ?? '',
      propertyType: body.propertyType || 'residential',
      preferredTime: body.preferredTime ?? '',
      notes: body.notes ?? '',
      visitPrice: num(body.visitPrice),
      billingCycle,
      customBillingCycle: billingCycle === 'custom' ? customBillingCycle : null,
    });
    return NextResponse.json({ job, linked: 0 }, { status: 201 });
  } catch (err) {
    console.error('Recurring create error:', err);
    return NextResponse.json({ error: 'Failed to create recurring customer' }, { status: 500 });
  }
}
