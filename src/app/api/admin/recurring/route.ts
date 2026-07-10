import { NextRequest, NextResponse } from 'next/server';
import { getRecurringJobs, addRecurringJob } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const jobs = await getRecurringJobs();
  return NextResponse.json(jobs);
}

export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { name, service, frequency, nextDate } = body;
    if (!name || !service || !frequency || !nextDate) {
      return NextResponse.json({ error: 'Name, service, frequency and next date are required' }, { status: 400 });
    }
    if (!['monthly', 'quarterly', 'biannual'].includes(frequency)) {
      return NextResponse.json({ error: 'Invalid frequency' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      return NextResponse.json({ error: 'Next date must be YYYY-MM-DD' }, { status: 400 });
    }
    const job = await addRecurringJob({
      name,
      service,
      frequency,
      nextDate,
      phone: body.phone ?? '',
      email: body.email ?? '',
      address: body.address ?? '',
      suburb: body.suburb ?? '',
      propertyType: body.propertyType || 'residential',
      preferredTime: body.preferredTime ?? '',
      notes: body.notes ?? '',
      discount: typeof body.discount === 'number' ? body.discount : null,
    });
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    console.error('Recurring create error:', err);
    return NextResponse.json({ error: 'Failed to create recurring job' }, { status: 500 });
  }
}
