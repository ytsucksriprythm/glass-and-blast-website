import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { getQuoteByToken } from '@/lib/db';
import { buildQuoteText, isPackageKey, isPackageQuote, longDate, money, PACKAGE_INFO, type Quote } from '@/lib/quote';
import QuoteAcceptedPopup from '@/components/QuoteAcceptedPopup';
import QuotePreview from '@/components/QuotePreview';
import QuotePackageCards from '@/components/QuotePackageCards';
import QuoteAcceptButton from '@/components/QuoteAcceptButton';
import PrintButton from '@/components/PrintButton';
import QuoteCopyButton from '@/components/QuoteCopyButton';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const quote = await getQuoteByToken(token);
  if (!quote) return { title: 'Quote not found' };
  return {
    title: `Quote ${quote.number} - ${quote.fromTradingAs}`,
    robots: { index: false, follow: false }, // private link, keep out of search
  };
}

export default async function PublicQuotePage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ package?: string; accepted?: string }>;
}) {
  const { token } = await params;
  const { package: picked, accepted } = await searchParams;
  const quote = await getQuoteByToken(token);
  if (!quote) notFound();

  // Three-package quote, not accepted yet: the three cards first, then the
  // formal quote for whichever one they pick (?package=). Once accepted, the
  // stored selectedPackage wins and ?package= is ignored.
  if (isPackageQuote(quote) && !quote.acceptedAt) {
    if (!isPackageKey(picked)) {
      return (
        <main className="quote-page min-h-[100svh] bg-slate-100 py-8 sm:py-14 px-4 sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            <div className="text-center mb-8 sm:mb-12">
              <div className="text-sky-700 font-semibold text-sm">{quote.fromTradingAs || 'Glass and Blast'} · Quote {quote.number}</div>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">Your Window Cleaning Quote Is Ready</h1>
              <p className="mt-3 text-slate-600">Please select one of the three packages below to view your formal quote.</p>
            </div>
            <QuotePackageCards prices={quote.packagePrices} hrefFor={k => `/quote/${token}?package=${k}`} />
            {quote.validUntil && <p className="mt-8 text-center text-slate-500 text-sm">Prices valid until {longDate(quote.validUntil)}.</p>}
            <Contact quote={quote} />
          </div>
        </main>
      );
    }
    const view = { ...quote, selectedPackage: picked };
    return (
      <QuoteShell quote={view}>
        <div className="no-print mt-5 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <a href={`/quote/${token}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> Change package
          </a>
          <QuoteAcceptButton token={token} pkg={picked} pkgName={PACKAGE_INFO[picked].name} />
        </div>
      </QuoteShell>
    );
  }

  return (
    <QuoteShell quote={quote}>
      {/* Straight after accepting (?accepted=1): thank-you popup over the quote */}
      {quote.acceptedAt && accepted === '1' && (
        <QuoteAcceptedPopup
          firstName={(quote.billToName ?? '').trim().split(/\s+/)[0] ?? ''}
          what={quote.selectedPackage ? `the ${PACKAGE_INFO[quote.selectedPackage].name} package` : 'your quote'}
          total={money(quote.amount)}
          phone={quote.fromPhone}
        />
      )}
      {quote.acceptedAt ? (
        <div className="no-print mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          You accepted {quote.selectedPackage ? `the ${PACKAGE_INFO[quote.selectedPackage].name} package` : 'this quote'} on {longDate(quote.acceptedAt.slice(0, 10))}. Thanks, we&apos;ll be in touch to lock in a time.
        </div>
      ) : (
        <div className="no-print mt-5 flex justify-end">
          <QuoteAcceptButton token={quote.token} />
        </div>
      )}
    </QuoteShell>
  );
}

function QuoteShell({ quote, children }: { quote: Quote; children?: React.ReactNode }) {
  return (
    <main className="quote-page min-h-[100svh] bg-slate-100 py-6 sm:py-12 px-3 sm:px-6">
      <div className="mx-auto w-full" style={{ maxWidth: '820px' }}>
        <div className="no-print mb-4 flex items-center justify-between flex-wrap gap-2">
          <span className="text-slate-500 text-sm">Quote {quote.number}</span>
          <div className="flex items-center gap-2">
            <QuoteCopyButton text={buildQuoteText(quote)} />
            <PrintButton />
          </div>
        </div>
        <div className="rounded-xl shadow-lg ring-1 ring-slate-200 overflow-hidden">
          <QuotePreview quote={quote} />
        </div>
        {children}
        <Contact quote={quote} />
      </div>
    </main>
  );
}

function Contact({ quote }: { quote: Quote }) {
  return (
    <p className="no-print mt-6 text-center text-slate-400 text-xs">
      Questions about this quote? Call {quote.fromPhone} or email {quote.fromEmail}.
    </p>
  );
}
