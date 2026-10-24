import { NextRequest, NextResponse } from 'next/server';
import { getCustomerBookings, createJobForCustomer, getRecurringJobs } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// [id] is any one of the customer's booking ids — see getCustomerBookings.
// GET → { anchor, bookings, recurring } (recurring = their profile, if any).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const found = await getCustomerBookings(id);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const recurringId = found.bookings.find(b => b.recurringId)?.recurringId;
  const recurring = recurringId ? (await getRecurringJobs()).find(j => j.id === recurringId) ?? null : null;
  return NextResponse.json({ ...found, recurring });
}

// POST { date, scheduledAt, price, notes } → a one-off job for this customer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return NextResponse.json({ error: 'Pick a date for the job' }, { status: 400 });
  }
  const booking = await createJobForCustomer(id, {
    date: body.date,
    scheduledAt: typeof body.scheduledAt === 'string' && !Number.isNaN(Date.parse(body.scheduledAt)) ? body.scheduledAt : null,
    price: typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : null,
    service: typeof body.service === 'string' ? body.service : undefined,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
  });
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(booking, { status: 201 });
}
