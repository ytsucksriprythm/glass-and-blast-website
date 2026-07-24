import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceByToken, logActivity } from '@/lib/db';
import { ACTIVITY_TYPE_LABEL } from '@/lib/activity';

export const dynamic = 'force-dynamic';

// Public, best-effort: lets the invoice page log a specific customer action
// (right now just "Pay by card" clicks) tied to that invoice's view log.
// Whitelisted event types only — this must never become an arbitrary log-injection endpoint.
const ALLOWED_TYPES = new Set(['invoice.pay_by_card_clicked']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const { type } = await req.json();
    if (typeof type !== 'string' || !ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
    }
    const invoice = await getInvoiceByToken(token);
    if (!invoice) return NextResponse.json({ ok: true }); // don't leak token validity
    await logActivity(type, `${ACTIVITY_TYPE_LABEL[type] ?? type} on ${invoice.number}`, null, 'customer', invoice.id);
  } catch { /* best-effort */ }
  return NextResponse.json({ ok: true });
}
