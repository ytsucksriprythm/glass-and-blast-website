import { NextRequest, NextResponse } from 'next/server';
import { updateBooking, deleteBooking, getBookingById, getGuestById } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import { notifyStatusChange, notifyJobAssigned } from '@/lib/notify';
import type { Booking } from '@/lib/db';

// Fields a guest is allowed to touch on a job that was sent to them. Notably
// absent: assignedGuestId (they can't reassign) and quoteAmount/adminNotes.
const GUEST_EDITABLE: (keyof Booking)[] = ['status', 'paid', 'paidAt', 'completedAt', 'notes'];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const booking = await getBookingById(id);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ctx.role === 'guest' && booking.assignedGuestId !== ctx.guestId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  return NextResponse.json(booking);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const before = await getBookingById(id);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  let updates: Partial<Booking> = body;
  let actor = 'Admin';

  if (ctx.role === 'guest') {
    if (before.assignedGuestId !== ctx.guestId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    // Whitelist: silently drop anything a guest may not change.
    const safe: Partial<Booking> = {};
    for (const k of GUEST_EDITABLE) {
      if (k in body) (safe as Record<string, unknown>)[k] = body[k];
    }
    updates = safe;
    const guest = await getGuestById(ctx.guestId);
    actor = guest?.name ?? 'Guest';
  }

  const booking = await updateBooking(id, updates);
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Push notifications (best-effort, never block the response).
  if (booking.status !== before.status) {
    void notifyStatusChange(booking, before.status, booking.status, actor);
  }
  if (booking.assignedGuestId && booking.assignedGuestId !== before.assignedGuestId) {
    const guest = await getGuestById(booking.assignedGuestId);
    if (guest) void notifyJobAssigned(booking, guest.name);
  }

  return NextResponse.json(booking);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  // Guests can never delete jobs.
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const ok = await deleteBooking(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
