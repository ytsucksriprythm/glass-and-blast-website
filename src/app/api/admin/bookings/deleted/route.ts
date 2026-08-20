import { NextResponse } from 'next/server';
import { getDeletedBookings } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Trash — bookings deleted within the last DELETED_BOOKING_RETENTION_DAYS
// (60), restorable from Settings -> Deleted bookings. Admin-only; guests
// never see deleted jobs, restored or not.
export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getDeletedBookings());
}
