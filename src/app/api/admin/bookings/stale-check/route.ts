import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { checkStaleLeads, checkUnscheduledPipeline } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Called once when the admin dashboard loads. Two auto-moves, run in this
// order so a booking can fall all the way through in one pass if it's due
// for both: Pipeline -> Leads first (quoted/confirmed, unscheduled a week),
// then Leads -> Cold (uncontacted/contacted, untouched 14 days — a job just
// reverted back to Leads is still judged by its original createdAt, so an
// old enough one can drop straight to Cold the same run). Returns only the
// bookings THIS call just moved (their new .status says which move it was)
// so the dashboard can show a one-time popup for them.
export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const revertedToLeads = await checkUnscheduledPipeline();
  const movedToCold = await checkStaleLeads();
  return NextResponse.json([...revertedToLeads, ...movedToCold]);
}
