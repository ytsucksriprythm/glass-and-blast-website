import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { receiveDataFlowsSms, receiveDataFlowsStatus, SmsError } from '@/lib/sms';

const uid = z.string().regex(/^[\w.-]{1,128}$/);
const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inbound'), uid, from: z.string().max(32), to: z.string().max(32),
    body: z.string().max(10000), timestamp: z.iso.datetime({ offset: true }) }),
  z.object({ type: z.literal('status'), uid, status: z.enum(['accepted', 'sent', 'delivered', 'failed']) }),
]);

export async function POST(request: Request) {
  // The trusted integration relay adds its own credential. No native DataFlows
  // signature format is assumed.
  const configured = process.env.DATAFLOWS_WEBHOOK_SECRET;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = Buffer.from('Bearer ' + configured);
  const actual = Buffer.from(supplied);
  if (!configured || configured.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const parsed = event.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
  try {
    const data = parsed.data;
    if (data.type === 'inbound') await receiveDataFlowsSms(data);
    else if (!await receiveDataFlowsStatus(data.uid, data.status)) {
      return NextResponse.json({ error: 'Message not recorded yet' }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof SmsError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('DataFlows relay event could not be stored', parsed.data.type);
    return NextResponse.json({ error: 'Could not process event' }, { status: 503 });
  }
}
