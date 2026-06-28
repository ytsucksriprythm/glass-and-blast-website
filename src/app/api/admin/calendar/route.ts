import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getUpcomingJobs } from '@/lib/calendar';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const data = await getUpcomingJobs();
  return NextResponse.json(data);
}
