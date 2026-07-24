import { NextRequest, NextResponse } from 'next/server';
import { getActivityLog } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Admin-only — the site-wide activity feed shown at the bottom of Settings.
export async function GET(req: NextRequest) {
  const ctx = await getActiveContext();
  if (!ctx || ctx.role !== 'admin') return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const limit = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 200));
  return NextResponse.json(await getActivityLog(limit));
}
