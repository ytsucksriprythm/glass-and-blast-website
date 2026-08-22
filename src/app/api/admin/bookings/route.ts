import { NextRequest, NextResponse } from 'next/server';
import { getBookings, getBookingsForGuest, getStats, addBooking, logActivity } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';

// Add a booking. Admin adds unassigned jobs; a guest's own bookings are
// auto-assigned to them so they show on their dashboard straight away.
export async function POST(req: NextRequest) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const b = await req.json();
    if (!b.name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    // A guest can never assign a job to someone else.
    const assignedGuestId = ctx.role === 'guest'
      ? ctx.guestId
      : (typeof b.assignedGuestId === 'string' && b.assignedGuestId ? b.assignedGuestId : null);

    const booking = await addBooking({
      name: b.name,
      email: b.email ?? '',
      phone: b.phone ?? '',
      service: b.service ?? '',
      propertyType: b.propertyType ?? 'residential',
      address: b.address ?? '',
      suburb: b.suburb ?? '',
      preferredDate: b.preferredDate ?? '',
      preferredTime: b.preferredTime ?? '',
      notes: b.notes ?? '',
      adminNotes: b.adminNotes ?? '',
      quoteAmount: typeof b.quoteAmount === 'number' ? b.quoteAmount : null,
      status: b.status ?? 'uncontacted',
      source: 'manual',
      assignedGuestId,
      // Internal calendar slot (from the calendar "Add" or a scheduled create).
      scheduledAt: typeof b.scheduledAt === 'string' && b.scheduledAt ? b.scheduledAt : null,
      scheduledEnd: typeof b.scheduledEnd === 'string' && b.scheduledEnd ? b.scheduledEnd : null,
      // "How did we get this job?" — manual-add attribution for source analytics.
      leadSource: typeof b.leadSource === 'string' && b.leadSource ? b.leadSource : null,
    });
    logActivity('booking.created', `${booking.name} added manually (${booking.service || 'no service'})`, { bookingId: booking.id }, ctx.role === 'admin' ? 'admin' : `guest:${ctx.guestId}`).catch(() => {});
    return NextResponse.json({ success: true, booking }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  try {
    if (type === 'stats') {
      // Business-wide stats are admin-only.
      if (ctx.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      return NextResponse.json(await getStats());
    }

    // Guests only ever see the jobs sent to them.
    const bookings = ctx.role === 'guest'
      ? await getBookingsForGuest(ctx.guestId)
      : await getBookings();

    const status = searchParams.get('status');
    const service = searchParams.get('service');
    const sort = searchParams.get('sort') ?? 'createdAt';
    const order = searchParams.get('order') ?? 'desc';
    const search = searchParams.get('search')?.toLowerCase() ?? '';

    let filtered = bookings;
    // Comma-separated = OR match across whatever's checked (multi-select
    // filter UI). 'facebook-lead-ad' is a synthetic status value that
    // actually matches on source, not status — see the Bookings tab filter.
    if (status && status !== 'all') {
      const statuses = status.split(',').filter(Boolean);
      filtered = filtered.filter(b => statuses.includes(b.status) || (statuses.includes('facebook-lead-ad') && b.source === 'facebook-lead-ad'));
    }
    if (service && service !== 'all') {
      const services = service.split(',').filter(Boolean);
      filtered = filtered.filter(b => (b.service ?? '').split(',').some(s => services.includes(s)));
    }
    if (search) filtered = filtered.filter(b =>
      b.name.toLowerCase().includes(search) ||
      b.email.toLowerCase().includes(search) ||
      b.phone.includes(search) ||
      b.address.toLowerCase().includes(search) ||
      b.suburb.toLowerCase().includes(search)
    );

    if (sort === 'sortOrder') {
      // Manual drag order (Bookings tab, select mode) — numeric, unset FLOATS
      // TO THE TOP. A booking only gets a sortOrder once someone drags it (or
      // anything else in the same view — a drag stamps the whole visible
      // list), so "unset" means "arrived after the last manual arrangement".
      // Sinking those to the bottom would bury every new lead (including
      // every incoming Facebook lead) below a manually-arranged block
      // forever; floating them to the top keeps "newest first" as the
      // default and lets a manual drag hold its position underneath. Two
      // unset rows must compare as a clean 0, not `Infinity - Infinity`
      // (= NaN, an invalid comparator return) — they then keep getBookings()'
      // underlying created_at DESC order via Array.sort's stability.
      filtered = [...filtered].sort((a, b) => {
        if (a.sortOrder == null && b.sortOrder == null) return 0;
        if (a.sortOrder == null) return -1;
        if (b.sortOrder == null) return 1;
        return a.sortOrder - b.sortOrder;
      });
    } else {
      filtered.sort((a, b) => {
        const av = a[sort as keyof typeof a] ?? '';
        const bv = b[sort as keyof typeof b] ?? '';
        return order === 'asc'
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }

    return NextResponse.json(filtered);
  } catch (e) {
    return NextResponse.json({ error: 'DB_ERROR', message: e instanceof Error ? e.message : String(e), hasDbUrl: Boolean(process.env.DATABASE_URL) }, { status: 500 });
  }
}
