import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { ensureBookingToken } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Returns the booking's customer-link token, minting one for old rows.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const token = await ensureBookingToken(id);
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ token });
}
