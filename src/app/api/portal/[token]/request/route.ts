import { NextRequest, NextResponse } from 'next/server';
import { getAuthedProfile, requestNewJob, requestReschedule } from '@/lib/portal';

export const dynamic = 'force-dynamic';

// POST { type: 'book' | 'reschedule', bookingId?, preferredDate, preferredTime?, note? }
// Either way it's a request — we get an ntfy push and confirm with them.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await getAuthedProfile(token);
  if (!job) return NextResponse.json({ error: 'Enter your PIN' }, { status: 401 });
  if (!job.portal?.contract) return NextResponse.json({ error: 'Please sign your agreement first' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const preferredDate = typeof body.preferredDate === 'string' ? body.preferredDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return NextResponse.json({ error: 'Pick a date' }, { status: 400 });
  const input = {
    preferredDate,
    preferredTime: typeof body.preferredTime === 'string' ? body.preferredTime.slice(0, 40) : '',
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '',
  };

  if (body.type === 'book') {
    const r = await requestNewJob(job, input);
    return NextResponse.json(r, { status: 201 });
  }
  if (body.type === 'reschedule' && typeof body.bookingId === 'string') {
    const r = await requestReschedule(job, body.bookingId, input);
    if (!r) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json(r, { status: 201 });
  }
  return NextResponse.json({ error: 'Unknown request' }, { status: 400 });
}
