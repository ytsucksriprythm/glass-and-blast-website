import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated, getActiveContext, hashPassword } from '@/lib/auth';
import { getGuests, addGuest } from '@/lib/db';
import type { Guest } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Never leak password hashes to the client.
const publicGuest = (g: Guest) => ({ id: g.id, name: g.name, active: g.active, createdAt: g.createdAt });

export async function GET() {
  // The guest selector on the admin dashboard needs this; a guest context does not.
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const guests = await getGuests();
  return NextResponse.json(guests.map(publicGuest));
}

export async function POST(req: NextRequest) {
  // Only the master admin (not an impersonated guest context) may create logins.
  const ctx = await getActiveContext();
  if (!await isAdminAuthenticated() || ctx?.role !== 'admin') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  try {
    const { name, password } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!password || password.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 });
    }
    const guest = await addGuest({ name: name.trim(), passwordHash: hashPassword(password) });
    return NextResponse.json(publicGuest(guest), { status: 201 });
  } catch (err) {
    console.error('Guest create error:', err);
    return NextResponse.json({ error: 'Failed to create guest' }, { status: 500 });
  }
}
