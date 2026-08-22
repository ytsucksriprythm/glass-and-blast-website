import { NextRequest, NextResponse } from 'next/server';
import { getQuotes, getQuotesForBooking, createQuote, logActivity, getSettings } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { addDays, DEFAULT_QUOTE_TERMS, DEFAULT_QUOTE_ASSUMPTIONS, DEFAULT_PAYMENT_DUE_TERMS, isPaymentDueTerms, QUOTE_VALID_DAYS, type QuoteInput, type QuoteOtherLine } from '@/lib/quote';
import { BUSINESS_DEFAULTS } from '@/lib/invoice';

export const dynamic = 'force-dynamic';

// Admin-only, both ways — quoting is already a guest-restricted concern
// (guests can't PATCH quoteAmount on a booking today either).
export async function GET(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const bookingId = req.nextUrl.searchParams.get('bookingId');
  const quotes = bookingId ? await getQuotesForBooking(bookingId) : await getQuotes();
  return NextResponse.json(quotes);
}

export async function POST(req: NextRequest) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  try {
    const b = await req.json();
    const bookingId = (b.bookingId ?? '').trim();
    if (!bookingId) return NextResponse.json({ error: 'A booking is required' }, { status: 400 });

    const services = Array.isArray(b.services) ? b.services.filter((x: unknown) => typeof x === 'string') : [];
    const extras = Array.isArray(b.extras) ? b.extras.filter((x: unknown) => typeof x === 'string') : [];
    const otherLines: QuoteOtherLine[] = Array.isArray(b.otherLines)
      ? b.otherLines
        .filter((l: unknown): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l: Record<string, unknown>, i: number) => ({
          id: typeof l.id === 'string' && l.id ? l.id : `ol-${i}`,
          description: typeof l.description === 'string' ? l.description : '',
          amount: Number(l.amount) || 0,
        }))
      : [];
    if (services.length === 0 && extras.length === 0 && !otherLines.some(l => l.description.trim())) {
      return NextResponse.json({ error: 'Check at least one service, extra, or add an Other line' }, { status: 400 });
    }

    const itemAmounts: Record<string, number> = {};
    if (b.itemAmounts && typeof b.itemAmounts === 'object') {
      for (const [k, v] of Object.entries(b.itemAmounts)) { const n = Number(v); if (!isNaN(n)) itemAmounts[k] = n; }
    }

    const settings = await getSettings();
    const quoteDate = b.quoteDate || new Date().toISOString().slice(0, 10);
    const input: QuoteInput = {
      bookingId,
      status: b.status === 'sent' ? 'sent' : 'draft',
      services, extras, itemAmounts, otherLines,
      amount: Number(b.amount) || 0,
      scope: b.scope ?? '',
      assumptions: b.assumptions ?? DEFAULT_QUOTE_ASSUMPTIONS,
      paymentTerms: isPaymentDueTerms(b.paymentTerms) ? b.paymentTerms : DEFAULT_PAYMENT_DUE_TERMS,
      propertyType: b.propertyType === 'commercial' ? 'commercial' : 'residential',
      billToName: b.billToName ?? '',
      billToAddress: b.billToAddress ?? '',
      fromName: b.fromName ?? BUSINESS_DEFAULTS.fromName,
      fromTradingAs: b.fromTradingAs ?? BUSINESS_DEFAULTS.fromTradingAs,
      fromAbn: b.fromAbn ?? BUSINESS_DEFAULTS.fromAbn,
      fromAddress: b.fromAddress ?? BUSINESS_DEFAULTS.fromAddress,
      fromEmail: b.fromEmail ?? BUSINESS_DEFAULTS.fromEmail,
      fromPhone: b.fromPhone ?? BUSINESS_DEFAULTS.fromPhone,
      showFromAddress: typeof b.showFromAddress === 'boolean' ? b.showFromAddress : settings.defaultShowAddressOnQuote,
      quoteDate,
      validUntil: b.validUntil || addDays(quoteDate, QUOTE_VALID_DAYS),
      notes: b.notes ?? '',
      termsText: b.termsText || DEFAULT_QUOTE_TERMS,
    };
    const quote = await createQuote(input);
    await logActivity('quote.created', `Quote ${quote.number} created (${quote.amount ? `$${quote.amount}` : 'no amount'})`, { quoteId: quote.id, bookingId: quote.bookingId }, 'admin');
    return NextResponse.json(quote, { status: 201 });
  } catch (err) {
    console.error('Quote create error:', err);
    return NextResponse.json({ error: 'Failed to create quote' }, { status: 500 });
  }
}
