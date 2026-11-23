import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveContext } from '@/lib/auth';
import { staffLabel } from '@/lib/staff';
import { listSmartActions, respondToSmartAction } from '@/lib/smartActions';
import { SMS_WELCOME_BODY } from '@/lib/sms';
import { getSettings } from '@/lib/db';
import { smartActionExamples } from '@/lib/smartActionExamples';
import { australianMobile } from '@/lib/smsTypes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const body = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  operation: z.enum(['approve', 'dismiss']),
  preview: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  phone: z.string().regex(/^\+614\d{8}$/).optional(),
});

export async function GET(request: Request) {
  const context = await getActiveContext();
  if (context?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const rawPhone = params.get('phone');
    const phone = rawPhone ? australianMobile(rawPhone) : null;
    if (rawPhone && !phone) return NextResponse.json({ error: 'Invalid mobile number.' }, { status: 400 });
    const localDemo = process.env.NODE_ENV === 'development' && params.get('demo') === '1';
    if (localDemo || (await getSettings()).larpModeActive) {
      return NextResponse.json({
        actions: phone ? [] : smartActionExamples, demo: true, smsEnabled: true, welcome: SMS_WELCOME_BODY,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ ...await listSmartActions(phone ?? undefined, !!phone && params.get('refresh') === '1'), welcome: SMS_WELCOME_BODY }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'Could not load Smart Actions.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const context = await getActiveContext();
  if (context?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  const input = body.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Invalid Smart Action.' }, { status: 400 });
  try {
    if ((await getSettings()).larpModeActive) {
      return NextResponse.json({ error: 'Live Smart Actions are paused in LARP mode.' }, { status: 409 });
    }
    const result = await respondToSmartAction(input.data.id, input.data.operation, input.data.preview, staffLabel(context.profile), input.data.phone);
    if (result?.status === 'expired') return NextResponse.json({ error: 'This action changed, expired, or SMS is disabled. Refresh and review it again.' }, { status: 409 });
    return NextResponse.json({ result });
  } catch {
    return NextResponse.json({ error: 'Could not finish this action. Check its status before trying again.' }, { status: 500 });
  }
}
