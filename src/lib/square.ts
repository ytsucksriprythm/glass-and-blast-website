// Square Online Checkout (hosted "Payment Links") integration. Server-only —
// never import this from a client component (it needs SQUARE_ACCESS_TOKEN).
//
// Flow: we create a Payment Link for the invoice's card total (incl.
// surcharge); the customer is redirected to Square's own hosted checkout to
// enter card details (card data never touches our server, so no PCI scope);
// Square then POSTs a webhook back to /api/webhooks/square when the payment
// completes, which we match to this invoice via `order_id`.
import crypto from 'crypto';
import type { Invoice } from './invoice';

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
// Pin a known-good API version rather than floating on Square's default —
// bump this deliberately if you opt into a newer Square API release.
const SQUARE_VERSION = '2024-10-17';

function apiBase(): string {
  return process.env.SQUARE_ENV === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

export function squareConfigured(): boolean {
  return !!(ACCESS_TOKEN && LOCATION_ID);
}

export function squareWebhookConfigured(): boolean {
  return !!WEBHOOK_SIGNATURE_KEY;
}

// Creates a Square-hosted checkout page for `amount` (AUD, dollars — already
// includes any surcharge). Returns the link url + Square's order id (used to
// match the later webhook back to this invoice).
export async function createSquarePaymentLink(
  invoice: Pick<Invoice, 'id' | 'number' | 'token'>,
  amount: number,
  redirectUrl: string,
): Promise<{ url: string; orderId: string } | null> {
  if (!squareConfigured()) return null;

  const res = await fetch(`${apiBase()}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      quick_pay: {
        name: `Invoice ${invoice.number} — Glass and Blast`,
        price_money: { amount: Math.round(amount * 100), currency: 'AUD' },
        location_id: LOCATION_ID,
      },
      checkout_options: { redirect_url: redirectUrl },
    }),
  });

  if (!res.ok) {
    console.error('Square payment link create failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json();
  const link = data?.payment_link;
  if (!link?.url || !link?.order_id) return null;
  return { url: link.url as string, orderId: link.order_id as string };
}

// Verifies the `x-square-hmacsha256-signature` header: base64(HMAC-SHA256(
// signature_key, notification_url + raw_body)). `notificationUrl` must be the
// exact, full URL configured in the Square Developer Dashboard for this
// webhook subscription (protocol + host + path, no query string).
export function verifySquareSignature(rawBody: string, signatureHeader: string | null, notificationUrl: string): boolean {
  if (!WEBHOOK_SIGNATURE_KEY || !signatureHeader) return false;
  const expected = crypto.createHmac('sha256', WEBHOOK_SIGNATURE_KEY)
    .update(notificationUrl + rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
