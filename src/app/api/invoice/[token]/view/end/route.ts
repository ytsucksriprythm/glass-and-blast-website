import { NextRequest, NextResponse } from 'next/server';
import { endInvoiceViewSession } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Hit via navigator.sendBeacon when the invoice tab is hidden/closed, so we
// know how long the customer actually had it open. sendBeacon can't read a
// response, so this always just 200s.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (typeof body?.sessionId === 'string') await endInvoiceViewSession(body.sessionId);
  } catch { /* malformed beacon body — ignore */ }
  return NextResponse.json({ ok: true });
}
