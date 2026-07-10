import { NextRequest, NextResponse } from 'next/server';
import { deletePaymentProfile } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deletePaymentProfile(id);
  if (!ok) return NextResponse.json({ error: 'Not found or built-in' }, { status: 404 });
  return NextResponse.json({ success: true });
}
