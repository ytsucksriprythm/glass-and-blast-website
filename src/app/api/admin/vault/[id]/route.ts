import { NextRequest, NextResponse } from 'next/server';
import { updateVaultItem, deleteVaultItem, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;
  const b = await req.json();
  const updates: Record<string, string> = {};
  for (const k of ['label', 'value', 'notes'] as const) {
    if (typeof b[k] === 'string') updates[k] = b[k].trim();
  }
  if (updates.label === '') return NextResponse.json({ error: 'Label is required' }, { status: 400 });
  if (updates.value === '') return NextResponse.json({ error: 'Value is required' }, { status: 400 });
  const item = await updateVaultItem(id, updates);
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteVaultItem(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logActivity('vault.deleted', `Vault item deleted`, { id }, 'admin');
  return NextResponse.json({ success: true });
}
