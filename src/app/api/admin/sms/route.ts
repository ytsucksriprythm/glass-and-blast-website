import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getActiveContext } from '@/lib/auth';
import { staffLabel } from '@/lib/staff';
import { getInvoiceById, getQuoteById, getSmsPreference, listChatgptSmsReads, listLatestCustomerSms, listSms, listSmsReadStates, logActivity, markSmsRead, setSmsPreference, updateInvoice, updateQuote } from '@/lib/db';
import { smsPhone } from '@/lib/smsTypes';
import { resolveSmsTarget, sendSms, SmsError, smsEnabled } from '@/lib/sms';
import type { Quote } from '@/lib/quote';
import type { Invoice } from '@/lib/invoice';

const target = z.object({ kind: z.enum(['quote', 'invoice', 'booking', 'reminder', 'manual']), recordId: z.string().min(1).max(120) });
const input = target.extend({
  action: z.enum(['send', 'consent', 'opt-out']),
  requestId: z.string().uuid().optional(),
  text: z.string().max(500).optional(),
  approveQuote: z.boolean().optional(),
  approveInvoice: z.boolean().optional(),
});
const failure = (error: unknown) => error instanceof SmsError
  ? NextResponse.json({ error: error.message }, { status: error.status })
  : NextResponse.json({ error: 'SMS operation failed.' }, { status: 500 });

export async function GET(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  const parsed = target.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid record.' }, { status: 400 });
  try {
    const { phone } = await resolveSmsTarget(parsed.data);
    const manual = parsed.data.kind === 'manual';
    const thread = listSms(phone, false);
    const [messages, preference, states, incoming, chatgptReads] = await Promise.all([
      thread, getSmsPreference(phone),
      manual ? listSmsReadStates(phone) : null,
      manual ? listLatestCustomerSms(true, phone) : [],
      manual ? thread.then(rows => listChatgptSmsReads(rows.filter(row => row.direction === 'inbound').map(row => row.id))) : {},
    ]);
    const latestIncoming = incoming[0];
    return NextResponse.json({
      phone, messages, preference, readState: states?.[phone] ?? {}, chatgptReads, enabled: smsEnabled(),
      latestIncoming: latestIncoming && { id: latestIncoming.id, createdAt: latestIncoming.createdAt },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

const readInput = z.object({ phone: z.string().max(32), messageId: z.string().min(1).max(120) });

export async function PATCH(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  const parsed = readInput.safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? smsPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return NextResponse.json({ error: 'Invalid SMS receipt.' }, { status: 400 });
  try {
    await markSmsRead(phone, ctx.profile, parsed.data.messageId);
    return new Response(null, { status: 204 });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const ctx = await getActiveContext();
  if (ctx?.role !== 'admin') return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid SMS request.' }, { status: 400 });
  const action = parsed.data;
  const actor = staffLabel(ctx.profile);
  try {
    if (action.action === 'send') {
      let approvedQuote: Quote | null = null;
      let approvedInvoice: Invoice | null = null;
      if (action.kind === 'manual' && !action.requestId) throw new SmsError('A request ID is required.', 400);
      if (action.kind === 'quote' && action.approveQuote) {
        if (!smsEnabled()) throw new SmsError('Customer SMS sending is disabled.', 503);
        const { phone } = await resolveSmsTarget(action);
        if (await getSmsPreference(phone) === 'opted-out') throw new SmsError('This number opted out. The customer must text START to opt back in.');
        const quote = await getQuoteById(action.recordId);
        if (quote?.status === 'draft') {
          approvedQuote = await updateQuote(quote.id, { status: 'sent' });
          if (!approvedQuote) throw new SmsError('Quote not found.', 404);
          await logActivity('quote.status_changed', 'Quote approved for SMS', { quoteId: quote.id }, actor).catch(() => {});
        }
      }
      if (action.kind === 'invoice' && action.approveInvoice) {
        if (!smsEnabled()) throw new SmsError('Customer SMS sending is disabled.', 503);
        const { phone } = await resolveSmsTarget(action);
        if (await getSmsPreference(phone) === 'opted-out') throw new SmsError('This number opted out. The customer must text START to opt back in.');
        const invoice = await getInvoiceById(action.recordId);
        if (invoice?.status === 'draft') {
          approvedInvoice = await updateInvoice(invoice.id, { status: 'sent' });
          if (!approvedInvoice) throw new SmsError('Invoice not found.', 404);
          await logActivity('invoice.status_changed', 'Invoice approved for SMS', { invoiceId: invoice.id }, actor, invoice.id).catch(() => {});
        }
      }
      return NextResponse.json({ message: await sendSms(action, actor), approvedQuote, approvedInvoice });
    }
    const { phone } = await resolveSmsTarget(action);
    const preference = action.action === 'consent' ? 'opted-in' : 'opted-out';
    if (!await setSmsPreference(phone, preference, actor)) {
      throw new SmsError('This number opted out. The customer must text START to opt back in.');
    }
    await logActivity('sms.preference_changed', 'Customer SMS preference ' + preference, { recordId: action.recordId }, actor).catch(() => {});
    return NextResponse.json({ preference });
  } catch (error) { return failure(error); }
}
