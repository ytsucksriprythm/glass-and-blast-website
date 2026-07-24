import { NextRequest, NextResponse } from 'next/server';
import { updateRecurringJob, deleteRecurringJob, generateNextVisit } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

// POST { action: 'generate' } → roll the plan forward one visit now, creating a
// confirmed, calendar-scheduled booking (a future calendar entry).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'generate') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const result = await generateNextVisit(id);
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, booking: result.booking, job: result.job });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const updates = await req.json();
  if (updates.nextDate && !/^\d{4}-\d{2}-\d{2}$/.test(updates.nextDate)) {
    return NextResponse.json({ error: 'Next date must be YYYY-MM-DD' }, { status: 400 });
  }
  const job = await updateRecurringJob(id, updates);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteRecurringJob(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
