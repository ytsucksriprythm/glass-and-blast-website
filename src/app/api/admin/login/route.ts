import { isStaffProfile } from '@/lib/staff';
import { NextRequest, NextResponse } from 'next/server';
import {
  checkPassword, getAdminSession, createSessionToken, getSessionCookieConfig, getClearCookieConfig,
  createGuestToken, getGuestCookieConfig, getClearGuestCookieConfig, verifyPasswordHash,
} from '@/lib/auth';
import { getGuests } from '@/lib/db';

// One login box for everyone. The admin password grants the admin session; any
// active guest's password grants that guest's session. Logging in as one role
// always clears the other cookie, so you can never hold a guest session that
// silently carries admin rights (or vice versa).
export async function GET() {
  const session = await getAdminSession();
  const role = session?.profile === 'pending' ? 'choose-profile' : session ? 'admin' : null;
  return NextResponse.json({ role }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const { password, remember = true, profile, switchProfile } = await req.json().catch(() => ({}));
  if (profile !== undefined) {
    const session = await getAdminSession();
    const canChoose = session?.profile === 'pending' && switchProfile !== true;
    const canSwitch = switchProfile === true && isStaffProfile(session?.profile) &&
      req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
    if (!session || !isStaffProfile(profile) || (!canChoose && !canSwitch)) {
      return NextResponse.json({ error: 'Enter your password again.' }, { status: 401 });
    }
    const response = NextResponse.json({ success: true, role: "admin", profile });
    const cookie = getSessionCookieConfig(createSessionToken(profile, session.remember), session.remember);
    response.cookies.set(cookie.name, cookie.value, cookie);
    return response;
  }
  if (typeof password !== "string") return NextResponse.json({ error: "Invalid password" }, { status: 401 });

  if (checkPassword(password)) {
    const res = NextResponse.json({ success: true, role: 'choose-profile' });
    const admin = { ...getSessionCookieConfig(createSessionToken("pending", remember), remember), maxAge: 300 };
    res.cookies.set(admin.name, admin.value, admin);
    const clearGuest = getClearGuestCookieConfig();
    res.cookies.set(clearGuest.name, clearGuest.value, { maxAge: 0, path: '/' });
    return res;
  }

  // Not the admin password — try the guest logins.
  try {
    const guests = await getGuests();
    const guest = guests.find(g => g.active && verifyPasswordHash(password, g.passwordHash));
    if (guest) {
      const res = NextResponse.json({ success: true, role: 'guest', guest: { id: guest.id, name: guest.name } });
      const gc = getGuestCookieConfig(createGuestToken(guest.id), remember);
      res.cookies.set(gc.name, gc.value, gc);
      const clearAdmin = getClearCookieConfig();
      res.cookies.set(clearAdmin.name, clearAdmin.value, { maxAge: 0, path: '/' });
      return res;
    }
  } catch (err) {
    console.error('[login] guest lookup failed:', err);
  }

  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}

// Full sign-out: drop both the admin and guest sessions.
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  const admin = getClearCookieConfig();
  const guest = getClearGuestCookieConfig();
  res.cookies.set(admin.name, admin.value, { maxAge: 0, path: '/' });
  res.cookies.set(guest.name, guest.value, { maxAge: 0, path: '/' });
  return res;
}
