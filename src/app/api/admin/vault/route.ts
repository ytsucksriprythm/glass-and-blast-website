import { NextRequest, NextResponse } from 'next/server';
import { getVaultItems, addVaultItem, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Admin-only both ways — this can hold real secrets (ntfy topic, webhook
// URLs, etc), so unlike payment/business profiles guests never see it.
export async function GET() {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await getVaultItems());
}

export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  try {
    const b = await req.json();
    const label = (b.label ?? '').trim();
    const value = (b.value ?? '').trim();
    if (!label) return NextResponse.json({ error: 'Label is required' }, { status: 400 });
    if (!value) return NextResponse.json({ error: 'Value is required' }, { status: 400 });
    const item = await addVaultItem({ label, value, notes: (b.notes ?? '').trim() });
    await logActivity('vault.created', `Vault item saved: ${label}`, { id: item.id }, 'admin');
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error('Vault item create error:', err);
    return NextResponse.json({ error: 'Failed to create vault item' }, { status: 500 });
  }
}
