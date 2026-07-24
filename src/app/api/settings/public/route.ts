import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

// No auth — only the handful of settings the public marketing site needs to
// decide its own behavior (never anything sensitive).
export async function GET() {
  const s = await getSettings();
  return NextResponse.json({ acceptingNewBookings: s.acceptingNewBookings });
}
