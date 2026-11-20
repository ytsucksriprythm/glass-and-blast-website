import { staffLabel } from '@/lib/staff';
import { NextRequest, NextResponse } from 'next/server';
import { getInvoices, createInvoice, getSettings, getBusinessProfiles, getPaymentProfiles, logActivity } from '@/lib/db';
import { getActiveContext } from '@/lib/auth';
import { documentBusinessDefaults, documentPaymentDefaults } from '@/lib/documentDefaults';
import { type InvoiceInput } from '@/lib/invoice';

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
    const isTaxInvoice = !!b.isTaxInvoice;
    // Tax invoices always show the address; otherwise use whatever the
    // client sent, falling back to the Settings default if it omitted it.
    const settings = await getSettings();
    const staff = ctx.role === "admin" ? ctx.profile : null;
    const [businessProfiles, paymentProfiles] = staff ? await Promise.all([getBusinessProfiles(), getPaymentProfiles()]) : [[], []];
    const business = documentBusinessDefaults(staff, businessProfiles, !staff || settings.autofillBusinessInfo);
    const payment = documentPaymentDefaults(staff, paymentProfiles, !staff || settings.autofillPaymentDetails);
    const showFromAddress = isTaxInvoice
      ? true
      : (typeof b.showFromAddress === 'boolean' ? b.showFromAddress : settings.defaultShowAddressOnInvoice);
    const input: InvoiceInput = {
      isTaxInvoice,
      status: b.status === 'sent' || b.status === 'paid' ? b.status : 'draft',
      fromName: b.fromName ?? business.fromName,
      fromTradingAs: b.fromTradingAs ?? business.fromTradingAs,
      fromAbn: b.fromAbn ?? business.fromAbn,
      fromAddress: b.fromAddress ?? business.fromAddress,
      fromEmail: b.fromEmail ?? business.fromEmail,
      fromPhone: b.fromPhone ?? business.fromPhone,
      showFromAddress,
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
      payAccountName: b.payAccountName ?? payment.payAccountName,
      payBsb: b.payBsb ?? payment.payBsb,
      payAccountNumber: b.payAccountNumber ?? payment.payAccountNumber,
      bookingId: b.bookingId ?? null,
      bookingIds: Array.isArray(b.bookingIds) ? b.bookingIds.filter((x: unknown) => typeof x === 'string' && x) : [],
      // An invoice a guest creates belongs to them; admin invoices are unowned.
      ownerGuestId: ctx.role === 'guest' ? ctx.guestId : null,
    };
    const actor = ctx.role === "admin" ? staffLabel(ctx.profile) : "Guest";
    const invoice = await createInvoice(input, actor);
    logActivity('invoice.created', `Invoice ${invoice.number} created for ${invoice.billToName || 'no recipient'}`, { invoiceId: invoice.id, total: invoice.total }, ctx.role === 'guest' ? `guest:${ctx.guestId}` : actor);
    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    console.error('Invoice create error:', err);
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
  }
}
