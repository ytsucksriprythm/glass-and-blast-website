import { NextRequest, NextResponse } from 'next/server';
import { recordInvoiceView, createInvoiceViewSession } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { getClientIp, getGeo } from '@/lib/request-info';
import { classifyDevice, classifyBrowser } from '@/lib/activity';

export const dynamic = 'force-dynamic';

// Public beacon hit by the invoice page when a customer opens the link.
// Views from a logged-in admin (Lincoln / Liam previewing) are NOT counted —
// neither in the coarse viewCount nor the detailed view-session log below.
// Returns a sessionId so the client can later report how long it was open
// (POST /api/invoice/[token]/view/end).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await isAdminAuthenticated()) return NextResponse.json({ skipped: 'admin' });
  const inv = await recordInvoiceView(token);
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const ip = getClientIp(req);
  const ua = req.headers.get('user-agent') || '';
  const geo = await getGeo(req, ip);
  const sessionId = await createInvoiceViewSession(inv.id, {
    ip, deviceType: classifyDevice(ua), browser: classifyBrowser(ua),
    city: geo.city, region: geo.region, country: geo.country,
  });

  return NextResponse.json({ ok: true, sessionId });
}
