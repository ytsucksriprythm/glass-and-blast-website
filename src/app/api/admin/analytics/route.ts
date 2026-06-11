import { NextRequest, NextResponse } from 'next/server';
import { getSiteStats, getBusinessStats } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!await isAdminAuthenticated()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const type = new URL(req.url).searchParams.get('type');
  try {
    if (type === 'site') return NextResponse.json(await getSiteStats());
    if (type === 'business') return NextResponse.json(await getBusinessStats());
    return NextResponse.json({ error: 'Unknown stats type' }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: 'DB_ERROR', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
