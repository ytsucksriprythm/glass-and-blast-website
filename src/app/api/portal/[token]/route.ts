import { NextRequest, NextResponse } from 'next/server';
import { getAuthedProfile, portalView } from '@/lib/portal';

export const dynamic = 'force-dynamic';

// The customer's portal data. 401 until they've entered their PIN — nothing
// about the customer (not even their name) is returned before that.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await getAuthedProfile(token);
  if (!job) return NextResponse.json({ error: 'Enter your PIN' }, { status: 401 });
  return NextResponse.json(await portalView(job));
}
