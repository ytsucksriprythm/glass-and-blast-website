import { NextRequest, NextResponse } from 'next/server';
import { acceptQuotePackage, getQuoteByToken, logActivity } from '@/lib/db';
import { isPackageKey, isPackageQuote, money, PACKAGE_INFO } from '@/lib/quote';

export const dynamic = 'force-dynamic';

// Public: the customer accepts one package of a three-package quote. Only the
// package key is read from the body; the price is worked out on the server
// from the prices stored when the quote was made (see acceptQuotePackage).
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let pkg: unknown;
  try { pkg = (await req.json())?.package; } catch { /* bad body */ }
  if (!isPackageKey(pkg)) return NextResponse.json({ error: 'Pick a package first' }, { status: 400 });

  const existing = await getQuoteByToken(token);
  if (!existing || !isPackageQuote(existing)) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });

  const result = await acceptQuotePackage(token, pkg);
  if (!result) return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  const { quote, already } = result;
  if (already) {
    // Locked: report what was accepted, never switch it.
    return NextResponse.json({ ok: true, selectedPackage: quote.selectedPackage, alreadyAccepted: true }, { status: 409 });
  }

  const name = PACKAGE_INFO[pkg].name;
  await logActivity('quote.accepted', `${quote.number} accepted: ${name} (${money(quote.amount)})`, { quoteId: quote.id, bookingId: quote.bookingId, package: pkg, amount: quote.amount }, 'customer', quote.id);
  if (process.env.NTFY_TOPIC) {
    try {
      await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
        method: 'POST',
        body: `${quote.billToName || 'Customer'} picked ${name}, ${money(quote.amount)}`,
        headers: { Title: `Quote ${quote.number} accepted`, Tags: 'customer,white_check_mark', Click: `${process.env.NEXT_PUBLIC_URL ?? 'https://glassandblast.com.au'}/admin/bookings/${quote.bookingId}` },
      });
    } catch (err) { console.error('Push (ntfy) failed:', err); }
  }
  return NextResponse.json({ ok: true, selectedPackage: pkg });
}
