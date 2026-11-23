import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceById, updateInvoice, deleteInvoice, logActivity } from '@/lib/db';
import { getActiveContext, type ActiveContext } from '@/lib/auth';
import type { Invoice } from '@/lib/invoice';

const actorLabel = (ctx: NonNullable<ActiveContext>) => ctx.role === 'admin' ? 'admin' : `guest:${ctx.guestId}`;

export const dynamic = 'force-dynamic';

const ACCESS_DENIED = { error: 'Access denied' };

// A guest may only touch invoices they created. Anything else is Access Denied
// (403) — never 404, so the caller can render the right message.
function canAccess(ctx: NonNullable<ActiveContext>, invoice: Invoice): boolean {
  if (ctx.role === 'admin') return true;
  return invoice.ownerGuestId === ctx.guestId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccess(ctx, invoice)) return NextResponse.json(ACCESS_DENIED, { status: 403 });
  return NextResponse.json(invoice);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const existing = await getInvoiceById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccess(ctx, existing)) return NextResponse.json(ACCESS_DENIED, { status: 403 });

  const b = await req.json();

  // Whitelist editable fields; identity/number/seq/token/owner are never client-writable.
  const updates: Partial<Invoice> = {};
  const copy = <K extends keyof Invoice>(k: K) => { if (k in b) (updates as any)[k] = b[k]; };
  (['isTaxInvoice', 'status', 'paymentMethod', 'fromName', 'fromTradingAs', 'fromAbn', 'fromAddress', 'fromEmail', 'fromPhone',
    'showFromAddress', 'billToName', 'billToLines', 'invoiceDate', 'serviceDate', 'dueDate', 'notes',
    'payAccountName', 'payBsb', 'payAccountNumber', 'bookingId', 'bookingIds', 'sentAt', 'paidAt'] as (keyof Invoice)[])
    .forEach(copy);
  if (ctx.role === 'admin' && typeof b.reminderHold === 'boolean') updates.reminderHold = b.reminderHold;

  if ('cancellationMessage' in b || 'replacementInvoiceId' in b) {
    if ((updates.status ?? existing.status) !== 'cancelled') {
      return NextResponse.json({ error: 'Cancellation details require a cancelled invoice' }, { status: 400 });
    }
    if ('cancellationMessage' in b) {
      if (typeof b.cancellationMessage !== 'string' || b.cancellationMessage.length > 2000) {
        return NextResponse.json({ error: 'Keep the customer message to 2,000 characters' }, { status: 400 });
      }
      updates.cancellationMessage = b.cancellationMessage.trim();
    }
    if ('replacementInvoiceId' in b) {
      if (b.replacementInvoiceId === null) {
        updates.replacementInvoiceId = null;
      } else {
        const replacement = typeof b.replacementInvoiceId === 'string' && b.replacementInvoiceId !== id
          ? await getInvoiceById(b.replacementInvoiceId)
          : null;
        if (!replacement || !canAccess(ctx, replacement) || replacement.status === 'cancelled') {
          return NextResponse.json({ error: 'Choose an available replacement invoice' }, { status: 400 });
        }
        updates.replacementInvoiceId = replacement.id;
      }
    }
  }

  if ('client' in b && b.client) {
    updates.client = {
      show: !!b.client.show,
      clientName: b.client.clientName ?? '',
      trn: b.client.trn ?? '',
      fileNo: b.client.fileNo ?? '',
      claimRef: b.client.claimRef ?? '',
    };
  }
  if ('items' in b && Array.isArray(b.items)) {
    updates.items = b.items.map((it: any) => ({
      description: it.description ?? '',
      detail: it.detail ?? '',
      serviceAddress: it.serviceAddress ?? '',
      date: it.date ?? '',
      amount: Number(it.amount) || 0,
    }));
  }

  const invoice = await updateInvoice(id, updates);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (updates.status && updates.status !== existing.status) {
    const methodNote = updates.status === 'paid' && invoice.paymentMethod ? ` (${invoice.paymentMethod})` : '';
    await logActivity('invoice.status_changed', `${invoice.number} ${existing.status} -> ${updates.status}${methodNote}`, { from: existing.status, to: updates.status, paymentMethod: invoice.paymentMethod }, actorLabel(ctx), invoice.id);
  }
  if (updates.reminderHold !== undefined && updates.reminderHold !== (existing.reminderHold ?? false)) {
    await logActivity('invoice.reminder_hold_changed', updates.reminderHold ? 'Payment reminders paused' : 'Payment reminders resumed',
      { reminderHold: updates.reminderHold }, actorLabel(ctx), invoice.id);
  }
  return NextResponse.json(invoice);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getActiveContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;

  const existing = await getInvoiceById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canAccess(ctx, existing)) return NextResponse.json(ACCESS_DENIED, { status: 403 });

  const ok = await deleteInvoice(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logActivity('invoice.deleted', `Invoice ${existing.number} deleted`, { invoiceId: id, total: existing.total }, actorLabel(ctx));
  return NextResponse.json({ success: true });
}
