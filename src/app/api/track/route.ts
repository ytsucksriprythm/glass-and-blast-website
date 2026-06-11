import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { addPageView } from '@/lib/db';

// Public endpoint: records one page view. Designed to never throw back at the
// page — a tracking failure must not affect the visitor.
export async function POST(req: NextRequest) {
  try {
    const { path, referrer } = await req.json();
    if (typeof path !== 'string' || !path) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // Never track admin/api routes.
    if (path.startsWith('/admin') || path.startsWith('/api')) {
      return NextResponse.json({ ok: true });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ua = req.headers.get('user-agent') || '';
    const day = new Date().toISOString().slice(0, 10);
    // Privacy: store a daily hash, never the raw IP.
    const visitor = createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16);

    const ref = typeof referrer === 'string' ? referrer.slice(0, 300) : '';
    await addPageView({ path: path.slice(0, 300), referrer: ref, visitor });

    return NextResponse.json({ ok: true });
  } catch {
    // Swallow errors so the client never sees a tracking failure.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
