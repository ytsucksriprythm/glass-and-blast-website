import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceBySquareOrderId, updateInvoice, getSettings, logActivity } from '@/lib/db';
import { verifySquareSignature, squareWebhookConfigured } from '@/lib/square';
import { notifySquarePaid } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Public endpoint Square calls when a payment link's payment changes state.
// Never trusts the payload without a valid signature. On COMPLETED, this only
// records `squarePaidAt` as a CLAIM (see invoice.ts) — the real `paid` /
// `paymentMethod` flip stays a manual admin action once the money is actually
// seen in the account.
export async function POST(req: NextRequest) {
  const settings = await getSettings();
  // 200 (not an error status) so Square doesn't treat this as a delivery
  // failure and hammer retries while the feature is deliberately off (see
  // Settings -> Payments -> "Card payments enabled").
  if (!settings.squareCardPaymentsEnabled) return NextResponse.json({ received: true, disabled: true });
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
          await notifySquarePaid(invoice.number);
          await logActivity('square.paid', `Square confirmed a card payment for ${invoice.number}`, { paymentId: payment.id, orderId }, 'system', invoice.id);
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
