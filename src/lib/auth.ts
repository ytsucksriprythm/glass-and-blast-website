import { isStaffProfile, type StaffProfile } from './staff';
import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

// No hardcoded fallbacks: these MUST be provided via environment variables.
// If they are unset, admin auth fails closed (login disabled) rather than
// silently falling back to a publicly-known default.
const SECRET = process.env.ADMIN_SECRET;
const PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE_NAME = 'gb_admin_session';
const GUEST_COOKIE_NAME = 'gb_guest_session';
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

export function createSessionToken(profile: StaffProfile | 'pending', remember = true): string {
  const ttl = profile === 'pending' ? 300 : remember ? SESSION_MAX_AGE : SHORT_MAX_AGE;
  const payload = ['admin', profile, Math.floor(Date.now() / 1000) + ttl, remember ? 'remember' : 'short'].join(':');
  return Buffer.from(payload + ':' + sign(payload)).toString('base64');
}

function verifyAdminToken(token: string): { profile: StaffProfile | 'pending'; remember: boolean } | null {
  if (!SECRET) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const [role, profile, expires, mode, signature, extra] = decoded.split(':');
    if (extra !== undefined || role !== 'admin' || (!isStaffProfile(profile) && profile !== 'pending')) return null;
    const expiry = Number(expires);
    if (!Number.isFinite(expiry) || expiry <= Date.now() / 1000 || !signature || !['remember', 'short'].includes(mode)) return null;
    const expected = Buffer.from(sign([role, profile, expires, mode].join(':')));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    return { profile, remember: mode === 'remember' };
  } catch { return null; }
}

export async function getAdminSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token ? verifyAdminToken(token) : null;
}

export async function getStaffProfile(): Promise<StaffProfile | null> {
  const profile = (await getAdminSession())?.profile;
  return isStaffProfile(profile) ? profile : null;
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
  return (await getStaffProfile()) !== null;
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

// ─── Guest sessions ──────────────────────────────────────────────────────────
// Guests (subcontractors) get their own signed session cookie carrying the
// guest id. A guest session is distinct from the admin session; an admin can
// hold both at once while viewing "as" a guest (impersonation), which is how we
// keep the admin remembered when switching dashboards.

export function createGuestToken(guestId: string): string {
  const payload = `guest:${guestId}:${Date.now()}`;
  const sig = sign(payload);
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

// Returns the guest id if the token is valid and unexpired, else null.
export function verifyGuestToken(token: string): string | null {
  if (!SECRET) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastColon = decoded.lastIndexOf(':');
    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    if (sign(payload) !== sig) return null;
    const parts = payload.split(':'); // ['guest', <id>, <ts>]
    if (parts[0] !== 'guest' || parts.length < 3) return null;
    const ts = parseInt(parts[parts.length - 1]);
    if (isNaN(ts) || Date.now() - ts >= SESSION_MAX_AGE * 1000) return null;
    return parts.slice(1, -1).join(':');
  } catch {
    return null;
  }
}

export async function getGuestId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(GUEST_COOKIE_NAME)?.value;
  return token ? verifyGuestToken(token) : null;
}

export type ActiveContext = { role: 'admin'; profile: StaffProfile } | { role: 'guest'; guestId: string } | null;

// The dashboard/data context the current request is acting in. A live guest
// cookie always wins (so an impersonating admin sees the guest's world); else
// a valid admin cookie means the admin context; else unauthenticated.
export async function getActiveContext(): Promise<ActiveContext> {
  const guestId = await getGuestId();
  if (guestId) return { role: 'guest', guestId };
  const profile = await getStaffProfile();
  if (profile) return { role: 'admin', profile };
  return null;
}

export function getGuestCookieConfig(token: string, remember = true) {
  return {
    name: GUEST_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: remember ? SESSION_MAX_AGE : SHORT_MAX_AGE,
    path: '/',
  };
}

export function getClearGuestCookieConfig() {
  return { name: GUEST_COOKIE_NAME, value: '', httpOnly: true, maxAge: 0, path: '/' };
}

// Keyed hash for storing guest passwords (HMAC-SHA256 with ADMIN_SECRET).
export function hashPassword(pw: string): string {
  return sign(pw);
}

export function verifyPasswordHash(pw: string, hash: string): boolean {
  if (!SECRET) return false;
  try {
    const a = Buffer.from(sign(pw));
    const b = Buffer.from(hash);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Customer portal sessions ────────────────────────────────────────────────
// A recurring customer who entered their PIN at /portal/[token]. The cookie
// carries their profile id + the profile's sessionVersion, so issuing a new PIN
// (which bumps the version) signs every old session out. Scoped to /portal
// paths only; never grants anything admin-side.
const PORTAL_COOKIE_NAME = 'gb_portal_session';

export function createPortalToken(profileId: string, version: number): string {
  const payload = `portal:${profileId}:${version}:${Date.now()}`;
  return Buffer.from(`${payload}:${sign(payload)}`).toString('base64');
}

export async function getPortalSession(): Promise<{ profileId: string; version: number } | null> {
  if (!SECRET) return null;
  const token = (await cookies()).get(PORTAL_COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const lastColon = decoded.lastIndexOf(':');
    const payload = decoded.slice(0, lastColon);
    const a = Buffer.from(sign(payload));
    const b = Buffer.from(decoded.slice(lastColon + 1));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const [kind, profileId, version, ts] = payload.split(':');
    if (kind !== 'portal' || !profileId || Date.now() - parseInt(ts) >= SESSION_MAX_AGE * 1000) return null;
    return { profileId, version: parseInt(version) };
  } catch {
    return null;
  }
}

export function getPortalCookieConfig(token: string) {
  return {
    name: PORTAL_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  };
}

export function getClearPortalCookieConfig() {
  return { name: PORTAL_COOKIE_NAME, value: '', httpOnly: true, maxAge: 0, path: '/' };
}
