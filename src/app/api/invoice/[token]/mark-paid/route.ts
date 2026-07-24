import { NextRequest, NextResponse } from 'next/server';
import { markCustomerPaidByInvoiceToken } from '@/lib/db';
import { notifyCustomerMarkedPaid } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Public: customer taps "I've paid" on their invoice. Records the claim
// (customerMarkedPaidAt) and pings the owner — never touches the real `paid`
// flag, which stays a manual call once the money is seen in the account.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await markCustomerPaidByInvoiceToken(token);
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { booking, invoiceNumber } = result;
  await notifyCustomerMarkedPaid(booking, invoiceNumber);

  return NextResponse.json({
    success: true,
    thanksUrl: booking.publicToken ? `/thanks/${booking.publicToken}` : null,
  });
}
