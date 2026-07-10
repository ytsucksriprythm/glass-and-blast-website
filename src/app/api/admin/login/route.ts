import { NextRequest, NextResponse } from 'next/server';
import {
  checkPassword, createSessionToken, getSessionCookieConfig, getClearCookieConfig,
  createGuestToken, getGuestCookieConfig, getClearGuestCookieConfig, verifyPasswordHash,
} from '@/lib/auth';
import { getGuests } from '@/lib/db';

// One login box for everyone. The admin password grants the admin session; any
// active guest's password grants that guest's session. Logging in as one role
// always clears the other cookie, so you can never hold a guest session that
// silently carries admin rights (or vice versa).
export async function POST(req: NextRequest) {
  const { password, remember = true } = await req.json();

  if (checkPassword(password)) {
    const res = NextResponse.json({ success: true, role: 'admin' });
    const admin = getSessionCookieConfig(createSessionToken(), remember);
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
