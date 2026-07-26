import { NextRequest, NextResponse } from 'next/server';
import { deletePaymentProfile, updatePaymentProfile } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Editing is allowed on any profile, built-in included — only DELETE is restricted.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const b = await req.json();
  const updates: Record<string, string> = {};
  for (const k of ['name', 'accountName', 'bsb', 'accountNumber'] as const) {
    if (typeof b[k] === 'string') updates[k] = b[k].trim();
  }
  if (updates.name === '') return NextResponse.json({ error: 'Profile name is required' }, { status: 400 });
  const profile = await updatePaymentProfile(id, updates);
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(profile);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deletePaymentProfile(id);
  if (!ok) return NextResponse.json({ error: 'Not found or built-in' }, { status: 404 });
  return NextResponse.json({ success: true });
}
