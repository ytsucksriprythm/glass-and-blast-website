import { NextResponse } from 'next/server';
import { isAdminAuthenticated, getActiveContext } from '@/lib/auth';
import { getGuestById } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Who the current request is acting as.
 *  - role: the active dashboard context ('admin' | 'guest' | null)
 *  - isAdmin: whether a valid admin session is also held. When role is 'guest'
 *    and isAdmin is true, an admin is viewing as that guest and can switch back
 *    without re-entering the password.
 */
export async function GET() {
  const [isAdmin, ctx] = await Promise.all([isAdminAuthenticated(), getActiveContext()]);

  if (ctx?.role === 'guest') {
    const guest = await getGuestById(ctx.guestId);
    if (!guest || !guest.active) {
      // Stale or disabled guest cookie — treat as signed out of the guest context.
      return NextResponse.json({ role: isAdmin ? 'admin' : null, isAdmin, guest: null });
    }
    return NextResponse.json({
      role: 'guest',
      isAdmin,
      guest: { id: guest.id, name: guest.name },
    });
  }

  return NextResponse.json({ role: ctx?.role ?? null, isAdmin, guest: null });
}
