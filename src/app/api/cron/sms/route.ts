import { NextResponse } from 'next/server';
import { checkStaleLeads } from '@/lib/db';
import { runSmsCron } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== 'Bearer ' + secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [sms, movedToCold] = await Promise.all([runSmsCron(), checkStaleLeads()]);
  return NextResponse.json({ ...sms, movedToCold: movedToCold.length });
}
