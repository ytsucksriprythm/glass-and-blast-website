import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getBookingsInRange } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Internal calendar feed. The calendar is NOT a separate store — it reads
// bookings that have a scheduledAt slot. `start`/`end` are ISO instants
// bounding the visible range (default: the current month).
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const start = searchParams.get('start') ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = searchParams.get('end') ?? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const bookings = await getBookingsInRange(start, end);
  return NextResponse.json({ bookings });
}
