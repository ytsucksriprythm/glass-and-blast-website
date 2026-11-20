import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveContext } from '@/lib/auth';
import { CallingError, callingSnapshot, outcomeSchema, policySchema, recordCall, releaseCall, reserveCall, saveCallPolicy } from '@/lib/calling';

const sessionSchema = z.string().min(8).max(120);
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reserve'), session: sessionSchema, bookingId: z.string().max(120).optional(), excludedIds: z.array(z.string().max(120)).max(5000).optional() }),
  z.object({ action: z.literal('release'), session: sessionSchema, bookingId: z.string().max(120) }),
  z.object({ action: z.literal('outcome'), session: sessionSchema, input: outcomeSchema }),
  z.object({ action: z.literal('policy'), session: sessionSchema, input: policySchema }),
]);
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Sign in to use Call List.' }, { status: 401 });
  const session = sessionSchema.safeParse(new URL(request.url).searchParams.get('session'));
  const snapshot = await callingSnapshot({ staff: ctx.profile, session: session.success ? session.data : '' });
  return NextResponse.json({ ...snapshot, rows: snapshot.rows.map(({ state: { lease, ...state }, ...row }) => ({ ...row, state })) }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Sign in to use Call List.' }, { status: 401 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
  const input = parsed.data;
  const actor = { staff: ctx.profile, session: input.session };
  try {
    switch (input.action) {
      case 'reserve': {
        const lead = await reserveCall(actor, input.bookingId, input.excludedIds);
        if (!lead) return NextResponse.json({ lead: null });
        const { lease, ...state } = lead.state;
        return NextResponse.json({ lead: { ...lead, state }, expires: lease?.expires });
      }
      case 'release': await releaseCall(actor, input.bookingId); return NextResponse.json({ ok: true });
      case 'policy': return NextResponse.json({ policy: await saveCallPolicy(input.input) });
      case 'outcome': return NextResponse.json({ event: await recordCall(actor, input.input, !['assign', 'reopen'].includes(input.input.outcome)) });
    }
  } catch (error) {
    if (error instanceof CallingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[calling]', error);
    return NextResponse.json({ error: 'Could not save. Your draft is still available to retry.' }, { status: 500 });
  }
}
