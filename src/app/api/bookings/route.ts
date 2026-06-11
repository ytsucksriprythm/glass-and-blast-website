import { NextRequest, NextResponse } from 'next/server';
import { addBooking } from '@/lib/db';
import { sendBookingNotifications } from '@/lib/notifications';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, service, propertyType, address, suburb, preferredDate, preferredTime, notes } = body;

    if (!name || !phone || !address || !service) {
      return NextResponse.json({ error: 'Name, phone, address and service are required' }, { status: 400 });
    }

    const booking = await addBooking({
      name, phone, address, service,
      email: email ?? '',
      propertyType: propertyType || 'residential',
      suburb: suburb ?? '',
      preferredDate: preferredDate ?? '',
      preferredTime: preferredTime ?? '',
      notes: notes ?? '',
    });

    // Send notifications async (don't fail booking if email fails)
    sendBookingNotifications(booking).catch(console.error);

    return NextResponse.json({ success: true, booking }, { status: 201 });
  } catch (err) {
    console.error('Booking error:', err);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
