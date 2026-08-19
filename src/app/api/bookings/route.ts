import { NextRequest, NextResponse } from 'next/server';
import { addBooking, getSettings, logActivity } from '@/lib/db';
import { sendBookingNotifications } from '@/lib/notifications';
import { labelAttribution, type AttributionInput } from '@/lib/attribution';

// Caps each raw attribution field to a sane length before it ever reaches
// labelAttribution() — this is public, unauthenticated input (first-touch
// data captured client-side, see src/components/PageTracker.tsx), so it's
// trusted for length only, never rendered raw (labelAttribution always maps
// it down to a known label or a capped hostname).
function sanitizeAttribution(raw: unknown): AttributionInput {
  const s = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 300) : null);
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { utmSource: s(a.utmSource), utmMedium: s(a.utmMedium), utmCampaign: s(a.utmCampaign), referrer: s(a.referrer) };
}

export async function POST(req: NextRequest) {
  try {
    if (!(await getSettings()).acceptingNewBookings) {
      return NextResponse.json({ error: 'Not currently accepting new bookings' }, { status: 503 });
    }
    const body = await req.json();
    const { name, email, phone, service, propertyType, address, suburb, preferredDate, preferredTime, notes, attribution } = body;

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
      // "How did this customer find us" — see src/lib/attribution.ts and
      // PageTracker's first-touch capture.
      attributionSource: labelAttribution(sanitizeAttribution(attribution)),
    });

    // Send notifications async (don't fail booking if email fails)
    sendBookingNotifications(booking).catch(console.error);
    logActivity('booking.created', `${booking.name} booked ${service} (${booking.suburb || 'no suburb'})`, { bookingId: booking.id }, 'customer').catch(() => {});

    return NextResponse.json({ success: true, booking }, { status: 201 });
  } catch (err) {
    console.error('Booking error:', err);
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 });
  }
}
