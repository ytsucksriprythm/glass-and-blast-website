import { NextRequest, NextResponse } from 'next/server';
import { getSettings, updatePageViewOnLeave } from '@/lib/db';

// Public endpoint: records how far down a page a visitor got, and how long
// they stayed, before leaving it. Sent separately from the initial
// /api/track view (fired on arrival, before either is known), correlated by
// an opaque client-made-up viewId — not tied to any identity. Designed to
// never throw back at the page — same "must not affect the visitor"
// contract as /api/track.
export async function POST(req: NextRequest) {
  try {
    const { viewId, maxScrollPercent, durationSeconds } = await req.json();
    if (typeof viewId !== 'string' || !viewId) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof maxScrollPercent !== 'number' && typeof durationSeconds !== 'number') {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!(await getSettings()).siteTrackingEnabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

    await updatePageViewOnLeave(viewId.slice(0, 100), {
      maxScrollPercent: typeof maxScrollPercent === 'number' ? maxScrollPercent : undefined,
      durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch {
    // Swallow errors so the client never sees a tracking failure.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
