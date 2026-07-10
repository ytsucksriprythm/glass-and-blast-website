import { NextRequest, NextResponse } from 'next/server';
import { getInvoiceById, updateInvoice, deleteInvoice } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import type { Invoice } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const invoice = await getInvoiceById(id);
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const b = await req.json();

  // Whitelist editable fields; identity/number/seq/token are never client-writable.
  const updates: Partial<Invoice> = {};
  const copy = <K extends keyof Invoice>(k: K) => { if (k in b) (updates as any)[k] = b[k]; };
  (['isTaxInvoice', 'status', 'fromName', 'fromTradingAs', 'fromAbn', 'fromAddress', 'fromEmail', 'fromPhone',
    'billToName', 'billToLines', 'invoiceDate', 'serviceDate', 'dueDate', 'notes',
    'payAccountName', 'payBsb', 'payAccountNumber', 'bookingId', 'sentAt', 'paidAt'] as (keyof Invoice)[])
    .forEach(copy);

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
  return NextResponse.json(invoice);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const ok = await deleteInvoice(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true });
}
