import { NextRequest, NextResponse } from 'next/server';
import { getPaymentProfiles, addPaymentProfile } from '@/lib/db';
import { isAdminAuthenticated, getActiveContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Guests need to read profiles so they can pick who gets paid on their invoices.
export async function GET() {
  if (!await getActiveContext()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getPaymentProfiles());
}

// Creating a shared payment profile stays admin-only.
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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
