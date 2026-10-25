import { NextRequest, NextResponse } from 'next/server';
import { getAuthedProfile, signContract } from '@/lib/portal';

export const dynamic = 'force-dynamic';

// POST { signerName, signature (PNG data URL), agree: true } → signs the
// agreement once. Stores the exact text, the terms, time, IP and browser.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await getAuthedProfile(token);
  if (!job) return NextResponse.json({ error: 'Enter your PIN' }, { status: 401 });
  if (job.portal?.contract) return NextResponse.json({ error: 'Already signed' }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const signerName = typeof body.signerName === 'string' ? body.signerName.trim().slice(0, 120) : '';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  if (body.agree !== true) return NextResponse.json({ error: 'Tick the box to agree' }, { status: 400 });
  if (signerName.length < 2) return NextResponse.json({ error: 'Type your full name' }, { status: 400 });
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 400_000) {
    return NextResponse.json({ error: 'Draw your signature' }, { status: 400 });
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  await signContract(job, { signerName, signature, ip, userAgent: req.headers.get('user-agent') ?? '' });
  return NextResponse.json({ success: true });
}
