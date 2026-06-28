import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

// No hardcoded fallbacks: these MUST be provided via environment variables.
// If they are unset, admin auth fails closed (login disabled) rather than
// silently falling back to a publicly-known default.
const SECRET = process.env.ADMIN_SECRET;
const PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_NAME = 'gb_admin_session';
// Long session so the home-screen app rarely needs a re-login. "Keep me signed in"
// off shortens it to a day.
const SESSION_MAX_AGE = 60 * 60 * 24 * 60; // 60 days (token validity window)
const SHORT_MAX_AGE = 60 * 60 * 24;        // 1 day

if (!SECRET || !PASSWORD) {
  console.error('[auth] ADMIN_SECRET and/or ADMIN_PASSWORD not set — admin login is disabled until configured.');
}

function sign(value: string): string {
  if (!SECRET) throw new Error('ADMIN_SECRET is not configured');
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

export function createSessionToken(): string {
  const payload = `admin:${Date.now()}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

export function verifySessionToken(token: string): boolean {
  if (!SECRET) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastColon = decoded.lastIndexOf(':');
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const expected = sign(payload);
    if (sig !== expected) return false;
    // Check token not older than the session window
    const parts = payload.split(':');
    const ts = parseInt(parts[1]);
    return Date.now() - ts < SESSION_MAX_AGE * 1000;
  } catch {
    return false;
  }
}

export function checkPassword(password: string): boolean {
  if (!PASSWORD) return false;
  // Constant-time comparison to avoid leaking the password via timing.
  const a = Buffer.from(password);
  const b = Buffer.from(PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export function getSessionCookieConfig(token: string, remember = true) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: remember ? SESSION_MAX_AGE : SHORT_MAX_AGE,
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
