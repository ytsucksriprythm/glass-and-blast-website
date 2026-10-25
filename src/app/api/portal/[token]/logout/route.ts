import { NextResponse } from 'next/server';
import { getClearPortalCookieConfig } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(getClearPortalCookieConfig());
  return res;
}
