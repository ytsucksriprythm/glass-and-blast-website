import { NextRequest, NextResponse } from 'next/server';
import { markCustomerPaidByInvoiceToken, logActivity } from '@/lib/db';
import { notifyCustomerMarkedPaid } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Public: customer taps "I've paid" on their invoice. Records the claim
// (customerMarkedPaidAt) and pings the owner — never touches the real `paid`
// flag, which stays a manual call once the money is seen in the account.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await markCustomerPaidByInvoiceToken(token);
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { booking, invoiceNumber, invoiceId } = result;
  await notifyCustomerMarkedPaid(booking, invoiceNumber);
  await logActivity('invoice.customer_marked_paid', `${booking.name} tapped "I've paid" on ${invoiceNumber}`, { invoiceNumber }, 'customer', invoiceId);

  return NextResponse.json({
    success: true,
    thanksUrl: booking.publicToken ? `/thanks/${booking.publicToken}` : null,
  });
}
