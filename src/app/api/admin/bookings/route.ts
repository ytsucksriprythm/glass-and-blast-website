import { NextRequest, NextResponse } from 'next/server';
import { getBookings, getStats, addBooking } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

// Manually add a booking from the admin (door-to-door / business / phone).
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const b = await req.json();
    if (!b.name || !b.phone || !b.service || !b.propertyType) {
      return NextResponse.json({ error: 'Name, phone, service and property type are required' }, { status: 400 });
    }
    const booking = await addBooking({
      name: b.name,
      email: b.email ?? '',
      phone: b.phone,
      service: b.service,
      propertyType: b.propertyType,
      address: b.address ?? '',
      suburb: b.suburb ?? '',
      preferredDate: b.preferredDate ?? '',
      preferredTime: b.preferredTime ?? '',
      notes: b.notes ?? '',
      adminNotes: b.adminNotes ?? '',
      quoteAmount: typeof b.quoteAmount === 'number' ? b.quoteAmount : null,
      status: b.status ?? 'pending',
      source: 'manual',
    });
    return NextResponse.json({ success: true, booking }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!await isAdminAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  if (type === 'stats') {
    return NextResponse.json(await getStats());
  }

  const bookings = await getBookings();
  const status = searchParams.get('status');
  const service = searchParams.get('service');
  const sort = searchParams.get('sort') ?? 'createdAt';
  const order = searchParams.get('order') ?? 'desc';
  const search = searchParams.get('search')?.toLowerCase() ?? '';

  let filtered = bookings;
  if (status && status !== 'all') filtered = filtered.filter(b => b.status === status);
  if (service && service !== 'all') filtered = filtered.filter(b => b.service === service);
  if (search) filtered = filtered.filter(b =>
    b.name.toLowerCase().includes(search) ||
    b.email.toLowerCase().includes(search) ||
    b.phone.includes(search) ||
    b.address.toLowerCase().includes(search) ||
    b.suburb.toLowerCase().includes(search)
  );

  filtered.sort((a, b) => {
    const av = a[sort as keyof typeof a] ?? '';
    const bv = b[sort as keyof typeof b] ?? '';
    return order === 'asc'
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  return NextResponse.json(filtered);
}
