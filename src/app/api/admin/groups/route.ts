import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { getBookingGroups, createBookingGroup } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getBookingGroups());
}

// Create a group from a title + the selected booking ids.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json();
  const title = (typeof b.title === 'string' ? b.title : '').trim();
  const bookingIds: string[] = Array.isArray(b.bookingIds) ? b.bookingIds.filter((x: unknown) => typeof x === 'string') : [];
  if (!title) return NextResponse.json({ error: 'Group needs a title' }, { status: 400 });
  const group = await createBookingGroup(title, bookingIds);
  return NextResponse.json(group, { status: 201 });
}
