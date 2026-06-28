import { NextRequest, NextResponse } from 'next/server';
import { checkPassword, createSessionToken, getSessionCookieConfig, getClearCookieConfig } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { password, remember = true } = await req.json();
  if (!checkPassword(password)) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }
  const token = createSessionToken();
  const res = NextResponse.json({ success: true });
  const config = getSessionCookieConfig(token, remember);
  res.cookies.set(config.name, config.value, config);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  const config = getClearCookieConfig();
  res.cookies.set(config.name, config.value, { maxAge: 0, path: '/' });
  return res;
}
