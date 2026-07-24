import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthenticated, getActiveContext, hashPassword } from '@/lib/auth';
import { updateGuest, deleteGuest, getGuestById, logActivity } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function requireMasterAdmin() {
  const ctx = await getActiveContext();
  return (await isAdminAuthenticated()) && ctx?.role === 'admin';
}

// Rename, enable/disable, or reset a guest's password.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireMasterAdmin()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const b = await req.json();

  const updates: { name?: string; active?: boolean; passwordHash?: string } = {};
  if (typeof b.name === 'string' && b.name.trim()) updates.name = b.name.trim();
  if (typeof b.active === 'boolean') updates.active = b.active;
  if (typeof b.password === 'string' && b.password) {
    if (b.password.length < 4) return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 });
    updates.passwordHash = hashPassword(b.password);
  }

  const guest = await updateGuest(id, updates);
  if (!guest) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ id: guest.id, name: guest.name, active: guest.active, createdAt: guest.createdAt });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await requireMasterAdmin()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const existing = await getGuestById(id);
  const ok = await deleteGuest(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logActivity('guest.deleted', `Guest login "${existing?.name ?? id}" deleted`, { guestId: id }, 'admin');
  return NextResponse.json({ success: true });
}
