import { NextResponse } from 'next/server';
import { getActiveContext } from '@/lib/auth';
import { getSettings, logActivity } from '@/lib/db';
import { dataFlowsConfigured, dataFlowsCutoverReady, dataFlowsSender } from '@/lib/dataFlowsSms';
import { smsConfigured, smsEnabled } from '@/lib/sms';
import { smsMigrationReport } from '@/lib/smsMigration';
import { staffLabel } from '@/lib/staff';

export const dynamic = 'force-dynamic';

export async function GET() {
  if ((await getActiveContext())?.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  return NextResponse.json({ ...await smsMigrationReport(), ready: dataFlowsCutoverReady(),
    twilioConfigured: smsConfigured(), sendingEnabled: smsEnabled(), dataflowsConfigured: dataFlowsConfigured(),
    twilioNumber: process.env.TWILIO_SMS_FROM ?? null, dataflowsNumber: dataFlowsSender() },
  { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const context = await getActiveContext();
  if (context?.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  if ((await request.json().catch(() => null))?.confirm !== 'backfill-twilio') {
    return NextResponse.json({ error: 'Backfill confirmation required' }, { status: 400 });
  }
  if ((await getSettings()).smsDataFlowsNewConversations) {
    return NextResponse.json({ error: 'Turn off new-conversation cutover before backfilling.' }, { status: 409 });
  }
  if (!smsConfigured()) return NextResponse.json({ error: 'Configure Twilio first.' }, { status: 409 });
  const report = await smsMigrationReport(true);
  await logActivity('sms.routing_backfill', 'Historical SMS routing backfill', { count: report.backfilled }, staffLabel(context.profile));
  return NextResponse.json(report);
}
