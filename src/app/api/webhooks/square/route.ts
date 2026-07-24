import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceBySquareOrderId, updateInvoice } from '@/lib/db';
import { verifySquareSignature, squareWebhookConfigured } from '@/lib/square';
import { SQUARE_CARD_PAYMENTS_ENABLED } from '@/lib/invoice';
import { notify } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Public endpoint Square calls when a payment link's payment changes state.
// Never trusts the payload without a valid signature. On COMPLETED, this only
// records `squarePaidAt` as a CLAIM (see invoice.ts) — the real `paid` /
// `paymentMethod` flip stays a manual admin action once the money is actually
// seen in the account.
export async function POST(req: NextRequest) {
  // 200 (not an error status) so Square doesn't treat this as a delivery
  // failure and hammer retries while the feature is deliberately off.
  if (!SQUARE_CARD_PAYMENTS_ENABLED) return NextResponse.json({ received: true, disabled: true });
  if (!squareWebhookConfigured()) return NextResponse.json({ error: 'Not configured' }, { status: 501 });

  const rawBody = await req.text();
  // Must exactly match the notification URL configured in the Square
  // Developer Dashboard for this webhook subscription.
  const notificationUrl = `${process.env.NEXT_PUBLIC_URL || ''}/api/webhooks/square`;
  const signature = req.headers.get('x-square-hmacsha256-signature');
  if (!verifySquareSignature(rawBody, signature, notificationUrl)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'Bad payload' }, { status: 400 }); }

  try {
    if (event?.type === 'payment.updated') {
      const payment = event?.data?.object?.payment;
      const orderId = payment?.order_id;
      if (payment?.status === 'COMPLETED' && orderId) {
        const invoice = await getInvoiceBySquareOrderId(orderId);
        if (invoice && !invoice.squarePaidAt) {
          await updateInvoice(invoice.id, { squarePaidAt: new Date().toISOString(), squarePaymentId: payment.id ?? null });
          await notify(
            `Square: ${invoice.number} paid by card`,
            `Card payment completed via Square. Verify it's in the account, then mark ${invoice.number} paid.`,
            { tags: 'credit_card', priority: 'high' },
          );
        }
      }
    }
  } catch (err) {
    // Best-effort — a processing error here must not make Square retry forever
    // in a way that blocks; log and 200 so Square doesn't hammer retries.
    console.error('Square webhook processing error:', err);
  }

  return NextResponse.json({ received: true });
}
