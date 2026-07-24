import { NextRequest, NextResponse } from 'next/server';
import { submitBookingFeedback } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Public: customer submits a star rating (+ text for 1-3 stars) from the
// thank-you page. No auth — the unguessable token is the key.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const b = await req.json().catch(() => ({}));
  const stars = Number(b.stars);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
    return NextResponse.json({ error: 'Pick 1-5 stars' }, { status: 400 });
  }
  const text = typeof b.text === 'string' ? b.text.slice(0, 2000) : '';
  const updated = await submitBookingFeedback(token, stars, text);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
