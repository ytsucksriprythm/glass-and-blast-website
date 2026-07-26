import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { bulkReorderBookings } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Persist a manual drag-and-drop order from the Bookings tab's select mode.
// `ids` is the full new display order; each gets sort_order = its index.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const ids: string[] = Array.isArray(b.ids) ? b.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (ids.length === 0) return NextResponse.json({ error: 'No bookings to reorder' }, { status: 400 });
  const n = await bulkReorderBookings(ids);
  return NextResponse.json({ updated: n });
}
