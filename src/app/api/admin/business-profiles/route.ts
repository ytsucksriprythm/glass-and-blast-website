import { NextRequest, NextResponse } from 'next/server';
import { getBusinessProfiles, addBusinessProfile } from '@/lib/db';
import { isAdminAuthenticated, getActiveContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Guests need to read profiles so they can pick a "from" identity on their invoices.
export async function GET() {
  if (!await getActiveContext()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getBusinessProfiles());
}

// Creating a shared business profile stays admin-only.
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  try {
    const b = await req.json();
    const name = (b.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Profile name is required' }, { status: 400 });
    const profile = await addBusinessProfile({
      name,
      fromName: (b.fromName ?? '').trim(),
      fromTradingAs: (b.fromTradingAs ?? '').trim(),
      fromAbn: (b.fromAbn ?? '').trim(),
      fromAddress: (b.fromAddress ?? '').trim(),
      fromEmail: (b.fromEmail ?? '').trim(),
      fromPhone: (b.fromPhone ?? '').trim(),
    });
    return NextResponse.json(profile, { status: 201 });
  } catch (err) {
    console.error('Business profile create error:', err);
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 });
  }
}
