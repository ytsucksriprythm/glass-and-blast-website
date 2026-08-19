import { NextRequest, NextResponse } from 'next/server';
import { getQuotes, getQuotesForBooking, createQuote, logActivity } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { addDays, DEFAULT_QUOTE_TERMS, QUOTE_VALID_DAYS, type QuoteInput } from '@/lib/quote';
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
    const otherText = (b.otherText ?? '').trim();
    if (services.length === 0 && extras.length === 0 && !otherText) {
      return NextResponse.json({ error: 'Check at least one service, extra, or describe the job in Other' }, { status: 400 });
    }

    const quoteDate = b.quoteDate || new Date().toISOString().slice(0, 10);
    const input: QuoteInput = {
      bookingId,
      status: b.status === 'sent' ? 'sent' : 'draft',
      services, extras, otherText,
      amount: Number(b.amount) || 0,
      propertyType: b.propertyType === 'commercial' ? 'commercial' : 'residential',
      billToName: b.billToName ?? '',
      billToAddress: b.billToAddress ?? '',
      fromName: b.fromName ?? BUSINESS_DEFAULTS.fromName,
      fromTradingAs: b.fromTradingAs ?? BUSINESS_DEFAULTS.fromTradingAs,
      fromAbn: b.fromAbn ?? BUSINESS_DEFAULTS.fromAbn,
      fromAddress: b.fromAddress ?? BUSINESS_DEFAULTS.fromAddress,
      fromEmail: b.fromEmail ?? BUSINESS_DEFAULTS.fromEmail,
      fromPhone: b.fromPhone ?? BUSINESS_DEFAULTS.fromPhone,
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
