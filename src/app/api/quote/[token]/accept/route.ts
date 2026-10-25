import { NextRequest, NextResponse } from 'next/server';
import { acceptQuote, getQuoteByToken, logActivity } from '@/lib/db';
import { isPackageKey, isPackageQuote, money, PACKAGE_INFO } from '@/lib/quote';

export const dynamic = 'force-dynamic';

// Public: the customer accepts their quote. Single quotes need nothing in the
// body. Three-package quotes send only the package key; the price is worked
// out on the server from the prices stored when the quote was made (see
// acceptQuote). Anything else in the body is ignored.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty body is fine for single quotes */ }

  const existing = await getQuoteByToken(token);
  if (!existing) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  const pkg = isPackageQuote(existing) ? body.package : null;
  if (isPackageQuote(existing) && !isPackageKey(pkg)) return NextResponse.json({ error: 'Pick a package first' }, { status: 400 });

  const result = await acceptQuote(token, isPackageKey(pkg) ? pkg : null);
  if (!result) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  const { quote, already } = result;
  if (already) {
    // Locked: report what was accepted, never switch it.
    return NextResponse.json({ ok: true, selectedPackage: quote.selectedPackage ?? null, alreadyAccepted: true }, { status: 409 });
  }

  const what = quote.selectedPackage ? PACKAGE_INFO[quote.selectedPackage].name : 'quote';
  await logActivity('quote.accepted', `${quote.number} accepted${quote.selectedPackage ? `: ${what}` : ''} (${money(quote.amount)})`, { quoteId: quote.id, bookingId: quote.bookingId, package: quote.selectedPackage ?? null, amount: quote.amount }, 'customer', quote.id);
  if (process.env.NTFY_TOPIC) {
    try {
      await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
        method: 'POST',
        body: `${quote.billToName || 'Customer'} accepted ${quote.selectedPackage ? `${what}, ` : ''}${money(quote.amount)}`,
        headers: { Title: `Quote ${quote.number} accepted`, Tags: 'customer,white_check_mark', Click: `${process.env.NEXT_PUBLIC_URL ?? 'https://glassandblast.com.au'}/admin/bookings/${quote.bookingId}` },
      });
    } catch (err) { console.error('Push (ntfy) failed:', err); }
  }
  return NextResponse.json({ ok: true, selectedPackage: quote.selectedPackage ?? null });
}
