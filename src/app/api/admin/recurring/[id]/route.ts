import { NextRequest, NextResponse } from 'next/server';
import { updateRecurringJob, deleteRecurringJob } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

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
