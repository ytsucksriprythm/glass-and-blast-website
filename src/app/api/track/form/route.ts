import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { addFunnelEvent, getSettings } from '@/lib/db';
import { BOOKING_FUNNEL_STEPS } from '@/lib/analytics';

// Public endpoint: records the furthest step a visitor reached in the
// booking form (src/app/page.tsx's Book component) before leaving it or
// submitting. One row per session, sent once when they leave — see
// BOOKING_FUNNEL_STEPS. Designed to never throw back at the page, same
// contract as /api/track.
export async function POST(req: NextRequest) {
  try {
    const { step, submitted } = await req.json();
    if (typeof step !== 'string' || !(BOOKING_FUNNEL_STEPS as readonly string[]).includes(step)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!(await getSettings()).siteTrackingEnabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    const day = new Date().toISOString().slice(0, 10);
    // Privacy: same daily hash as page views, never the raw IP.
    const visitor = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16);

    await addFunnelEvent({ visitor, step, submitted: submitted === true });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
