import { NextResponse } from 'next/server';
import { getActiveContext } from '@/lib/auth';
import { listSmsConversations } from '@/lib/sms';

export async function GET(request: Request) {
  const context = await getActiveContext();
  if (context?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const incomingOnly = new URL(request.url).searchParams.get('incoming') === '1';
  return NextResponse.json(await listSmsConversations(incomingOnly, context.profile), { headers: { 'Cache-Control': 'no-store' } });
}
