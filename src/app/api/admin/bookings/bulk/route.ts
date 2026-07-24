import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { bulkUpdateBookingStatus, bulkDeleteBookings, type BookingStatus } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUSES: BookingStatus[] = ['pending', 'quoted', 'confirmed', 'completed', 'cancelled'];

// Bulk actions over a set of booking ids: delete, or change status.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'No bookings selected' }, { status: 400 });

  if (b.action === 'delete') {
    const n = await bulkDeleteBookings(ids);
    return NextResponse.json({ deleted: n });
  }
  if (b.action === 'status' && STATUSES.includes(b.status)) {
    const n = await bulkUpdateBookingStatus(ids, b.status);
    return NextResponse.json({ updated: n });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
