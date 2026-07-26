import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { checkStaleLeads } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Called once when the admin dashboard loads. Moves any "pending" booking
// that's sat untouched for 14+ days to "cold" and returns only the ones it
// JUST moved, so the dashboard can show a one-time popup for them.
export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const moved = await checkStaleLeads();
  return NextResponse.json(moved);
}
