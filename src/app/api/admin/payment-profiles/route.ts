import { NextRequest, NextResponse } from 'next/server';
import { getPaymentProfiles, addPaymentProfile } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getPaymentProfiles());
}

export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const b = await req.json();
    const name = (b.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Profile name is required' }, { status: 400 });
    const profile = await addPaymentProfile({
      name,
      accountName: (b.accountName ?? '').trim(),
      bsb: (b.bsb ?? '').trim(),
      accountNumber: (b.accountNumber ?? '').trim(),
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error('Payment profile create error:', err);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}
