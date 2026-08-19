import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { addPageView, getSettings } from '@/lib/db';

// Public endpoint: records one page view. Designed to never throw back at the
// page — a tracking failure must not affect the visitor.
export async function POST(req: NextRequest) {
  try {
    const { path, referrer, viewId } = await req.json();
    if (typeof path !== 'string' || !path) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Never track admin/api routes.
    if (path.startsWith('/admin') || path.startsWith('/api')) {
      return NextResponse.json({ ok: true });
    }
    if (!(await getSettings()).siteTrackingEnabled) return NextResponse.json({ ok: true, skipped: 'disabled' });

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    const day = new Date().toISOString().slice(0, 10);
    // Privacy: store a daily hash, never the raw IP.
    const visitor = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16);

    const ref = typeof referrer === 'string' ? referrer.slice(0, 300) : '';
    // Ties this row to the later scroll-depth beacon (see /api/track/scroll)
    // — just an opaque id the client made up, not tied to any identity.
    const vid = typeof viewId === 'string' && viewId ? viewId.slice(0, 100) : null;
    await addPageView({ path: path.slice(0, 300), referrer: ref, visitor, viewId: vid });

    return NextResponse.json({ ok: true });
  } catch {
    // Swallow errors so the client never sees a tracking failure.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
