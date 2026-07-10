import { NextRequest, NextResponse } from 'next/server';
import { recordInvoiceView } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Public beacon hit by the invoice page when a customer opens the link.
// Views from a logged-in admin (Lincoln / Liam previewing) are NOT counted.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await isAdminAuthenticated()) return NextResponse.json({ skipped: 'admin' });
  const inv = await recordInvoiceView(token);
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
