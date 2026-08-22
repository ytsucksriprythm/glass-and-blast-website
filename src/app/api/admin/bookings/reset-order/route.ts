import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { resetBookingSortOrder, logActivity } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Clears every booking's manual sort_order, so the list falls back to plain
// newest-first until someone drags again. Undoes a stale/accidental
// select-mode reorder that's parked ahead of new arrivals (including
// Facebook leads) — see resetBookingSortOrder() in db.ts.
export async function POST() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const n = await resetBookingSortOrder();
  if (n > 0) void logActivity('booking.sort_reset', `Manual sort order cleared on ${n} booking${n !== 1 ? 's' : ''} — list back to newest-first`, { count: n }, 'admin');
  return NextResponse.json({ cleared: n });
}
