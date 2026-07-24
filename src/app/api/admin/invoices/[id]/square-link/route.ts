import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceById, updateInvoice } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import { createSquarePaymentLink, squareConfigured } from '@/lib/square';
import { cardTotal } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

// Admin/guest (owner) action: (re)generate the Square payment link for this
// invoice. Re-running it after the invoice total changes replaces the old
// link with one for the new amount — Square doesn't support editing an
// existing payment link's price.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ctx.role !== 'admin' && invoice.ownerGuestId !== ctx.guestId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  if (!squareConfigured()) {
    return NextResponse.json({ error: 'Square is not configured (missing SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID)' }, { status: 400 });
  }

  const amount = cardTotal(invoice.total);
  const origin = process.env.NEXT_PUBLIC_URL || new URL(_req.url).origin;
  const link = await createSquarePaymentLink(invoice, amount, `${origin}/invoice/${invoice.token}`);
  if (!link) return NextResponse.json({ error: 'Square declined to create the payment link' }, { status: 502 });

  const updated = await updateInvoice(id, {
    squarePaymentLinkUrl: link.url,
    squareOrderId: link.orderId,
    squareLinkAmount: amount,
  });
  return NextResponse.json(updated);
}
