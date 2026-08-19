import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updatePageViewScroll } from '@/lib/db';

// Public endpoint: records how far down a page a visitor got before leaving
// it. Sent separately from the initial /api/track view (fired on arrival,
// before the final depth is known), correlated by an opaque client-made-up
// viewId — not tied to any identity. Designed to never throw back at the
// page — same "must not affect the visitor" contract as /api/track.
export async function POST(req: NextRequest) {
  try {
    const { viewId, maxScrollPercent } = await req.json();
    if (typeof viewId !== 'string' || !viewId || typeof maxScrollPercent !== 'number') {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!(await getSettings()).siteTrackingEnabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

    await updatePageViewScroll(viewId.slice(0, 100), maxScrollPercent);
    return NextResponse.json({ ok: true });
  } catch {
    // Swallow errors so the client never sees a tracking failure.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
