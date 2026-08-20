import { NextRequest, NextResponse } from 'next/server';
import { restoreBooking, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Undo a soft delete — the booking goes back to every normal list. Admin-only.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const booking = await restoreBooking(id);
  if (!booking) return NextResponse.json({ error: 'Not found (or not deleted)' }, { status: 404 });
  await logActivity('booking.restored', `${booking.name} restored from trash`, { bookingId: id }, 'admin');
  return NextResponse.json(booking);
}
