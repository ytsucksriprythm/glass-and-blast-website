import { createHmac } from 'crypto';
import { cookies } from 'next/headers';

const SECRET = process.env.ADMIN_SECRET ?? 'glass-blast-secret-2025';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'glass26';
const COOKIE_NAME = 'gb_admin_session';
const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

export function createSessionToken(): string {
  const payload = `admin:${Date.now()}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

export function verifySessionToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastColon = decoded.lastIndexOf(':');
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = sign(payload);
    if (sig !== expected) return false;
    // Check token not older than 24h
    const parts = payload.split(':');
    const ts = parseInt(parts[1]);
    return Date.now() - ts < COOKIE_MAX_AGE * 1000;
  } catch {
    return false;
  }
}

export function checkPassword(password: string): boolean {
  return password === PASSWORD;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export function getSessionCookieConfig(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  };
}

export function getClearCookieConfig() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    maxAge: 0,
    path: '/',
  };
}
