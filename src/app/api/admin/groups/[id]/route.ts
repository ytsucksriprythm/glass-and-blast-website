import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { deleteBookingGroup, deleteBookingGroupWithBookings } from '@/lib/db';

export const dynamic = 'force-dynamic';

// DELETE ?withBookings=true → also deletes every booking in the group (destructive).
// Default → deletes the group only; the bookings survive (group_id cleared).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const withBookings = new URL(req.url).searchParams.get('withBookings') === 'true';

  if (withBookings) {
    const { ok, deletedBookings } = await deleteBookingGroupWithBookings(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, deletedBookings });
  }
  const ok = await deleteBookingGroup(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
