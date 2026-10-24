import { NextRequest, NextResponse } from 'next/server';
import {
  getRecurringJobs, updateRecurringJob, deleteRecurringJob, generateNextVisit, createJobForProfile, getBookingsForRecurring,
} from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET → the customer's profile plus every booking linked to it.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const job = (await getRecurringJobs()).find(j => j.id === id);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const bookings = await getBookingsForRecurring(id);
  return NextResponse.json({ job, bookings });
}

// POST { action: 'generate' } → roll the plan forward one visit now, creating a
// confirmed, calendar-scheduled booking at the next due date.
// POST { action: 'create-job', date, scheduledAt, price, notes } → a new job
// for this customer on a date of your choosing, linked to the profile.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body?.action === 'generate') {
    const result = await generateNextVisit(id);
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, booking: result.booking, job: result.job });
  }

  if (body?.action === 'create-job') {
    if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return NextResponse.json({ error: 'Pick a date for the job' }, { status: 400 });
    }
    const scheduledAt = typeof body.scheduledAt === 'string' && !Number.isNaN(Date.parse(body.scheduledAt)) ? body.scheduledAt : null;
    const price = typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : null;
    const result = await createJobForProfile(id, {
      date: body.date,
      scheduledAt,
      price,
      service: typeof body.service === 'string' ? body.service : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, booking: result.booking, job: result.job }, { status: 201 });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const updates = await req.json();
  if (updates.nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(updates.nextDate)) {
    return NextResponse.json({ error: 'Next date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (updates.frequency === 'custom' && (!Number.isInteger(updates.customInterval) || updates.customInterval < 1)) {
    return NextResponse.json({ error: 'Custom timeframe needs a whole number (1 or more)' }, { status: 400 });
  }
  const job = await updateRecurringJob(id, updates);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(job);
}

// Deleting a profile keeps the customer's bookings, just unlinks them.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteRecurringJob(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
