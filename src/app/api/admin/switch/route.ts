import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated, createGuestToken, getGuestCookieConfig, getClearGuestCookieConfig } from '@/lib/auth';
import { getGuestById } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Admin -> guest. Sets the guest cookie but KEEPS the admin cookie, so the admin
// stays remembered and can switch back instantly. No password required.
export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { guestId } = await req.json();
  const guest = await getGuestById(guestId);
  if (!guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
  const res = NextResponse.json({ success: true, guest: { id: guest.id, name: guest.name } });
  const gc = getGuestCookieConfig(createGuestToken(guest.id), true);
  res.cookies.set(gc.name, gc.value, gc);
  return res;
}

// Guest view -> admin. Only works if an admin session is already held (i.e. the
// admin was impersonating). A real guest gets 403 and must enter the admin
// password via the normal login instead.
export async function DELETE() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const res = NextResponse.json({ success: true });
  const clear = getClearGuestCookieConfig();
  res.cookies.set(clear.name, clear.value, { maxAge: 0, path: '/' });
  return res;
}
