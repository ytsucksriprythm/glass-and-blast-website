import { NextRequest, NextResponse } from 'next/server';
import { getInvoices, createInvoice, logActivity } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import { BUSINESS_DEFAULTS, PAYMENT_DEFAULTS, type InvoiceInput } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Guests only ever see their own invoices; the admin sees everything.
  const invoices = await getInvoices(ctx.role === 'guest' ? ctx.guestId : undefined);
  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const b = await req.json();
    const items = Array.isArray(b.items) ? b.items : [];
    if (items.length === 0) {
      return NextResponse.json({ error: 'Add at least one line item' }, { status: 400 });
    }
    const input: InvoiceInput = {
      isTaxInvoice: !!b.isTaxInvoice,
      status: b.status === 'sent' || b.status === 'paid' ? b.status : 'draft',
      fromName: b.fromName ?? BUSINESS_DEFAULTS.fromName,
      fromTradingAs: b.fromTradingAs ?? BUSINESS_DEFAULTS.fromTradingAs,
      fromAbn: b.fromAbn ?? BUSINESS_DEFAULTS.fromAbn,
      fromAddress: b.fromAddress ?? BUSINESS_DEFAULTS.fromAddress,
      fromEmail: b.fromEmail ?? BUSINESS_DEFAULTS.fromEmail,
      fromPhone: b.fromPhone ?? BUSINESS_DEFAULTS.fromPhone,
      billToName: b.billToName ?? '',
      billToLines: b.billToLines ?? '',
      client: {
        show: !!(b.client?.show),
        clientName: b.client?.clientName ?? '',
        trn: b.client?.trn ?? '',
        fileNo: b.client?.fileNo ?? '',
        claimRef: b.client?.claimRef ?? '',
      },
      invoiceDate: b.invoiceDate ?? '',
      serviceDate: b.serviceDate ?? '',
      dueDate: b.dueDate ?? '',
      items: items.map((it: any) => ({
        description: it.description ?? '',
        detail: it.detail ?? '',
        serviceAddress: it.serviceAddress ?? '',
        date: it.date ?? '',
        amount: Number(it.amount) || 0,
      })),
      notes: b.notes ?? '',
      payAccountName: b.payAccountName ?? PAYMENT_DEFAULTS.payAccountName,
      payBsb: b.payBsb ?? PAYMENT_DEFAULTS.payBsb,
      payAccountNumber: b.payAccountNumber ?? PAYMENT_DEFAULTS.payAccountNumber,
      bookingId: b.bookingId ?? null,
      bookingIds: Array.isArray(b.bookingIds) ? b.bookingIds.filter((x: unknown) => typeof x === 'string' && x) : [],
      // An invoice a guest creates belongs to them; admin invoices are unowned.
      ownerGuestId: ctx.role === 'guest' ? ctx.guestId : null,
    };
    const invoice = await createInvoice(input);
    logActivity('invoice.created', `Invoice ${invoice.number} created for ${invoice.billToName || 'no recipient'}`, { invoiceId: invoice.id, total: invoice.total }, ctx.role === 'guest' ? `guest:${ctx.guestId}` : 'admin');
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error('Invoice create error:', err);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
