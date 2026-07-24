import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceById, getInvoiceViewSessions, getActivityLog } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// The "View log" for one invoice: every public-page open (IP/device/location/
// duration) merged with invoice-scoped events (paid claims, Square
// confirmation, pay-by-card clicks, status changes).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ctx.role !== 'admin' && invoice.ownerGuestId !== ctx.guestId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const [sessions, events] = await Promise.all([
    getInvoiceViewSessions(id),
    getActivityLog(500, id),
  ]);
  return NextResponse.json({ sessions, events });
}
