import { NextResponse } from 'next/server';
import { isAdminAuthenticated } from '@/lib/auth';
import { checkStaleLeads, checkUnscheduledPipeline } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Return the pipeline and cold moves made by this dashboard check.
export async function GET() {
  if (!(await isAdminAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const revertedToLeads = await checkUnscheduledPipeline();
  const movedToCold = await checkStaleLeads();
  return NextResponse.json([...revertedToLeads, ...movedToCold]);
}
