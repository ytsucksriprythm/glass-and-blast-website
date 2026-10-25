import { NextRequest, NextResponse } from 'next/server';
import { tryPortalLogin } from '@/lib/portal';
import { createPortalToken, getPortalCookieConfig } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST { pin } → sets the portal session cookie for this customer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const pin = typeof body.pin === 'string' ? body.pin.replace(/\D/g, '') : '';
  if (pin.length !== 4) return NextResponse.json({ error: 'Enter your 4-digit PIN' }, { status: 400 });
  const result = await tryPortalLogin(token, pin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const res = NextResponse.json({ firstName: result.job.name.split(' ')[0], name: result.job.name, signed: !!result.job.portal?.contract });
  res.cookies.set(getPortalCookieConfig(createPortalToken(result.job.id, result.job.portal!.sessionVersion)));
  return res;
}
