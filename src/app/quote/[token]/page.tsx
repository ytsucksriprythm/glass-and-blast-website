import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getQuoteByToken } from '@/lib/db';
import { buildQuoteText } from '@/lib/quote';
import QuotePreview from '@/components/QuotePreview';
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

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await getQuoteByToken(token);
  if (!quote) notFound();

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
        <p className="no-print mt-6 text-center text-slate-400 text-xs">
          Questions about this quote? Call {quote.fromPhone} or email {quote.fromEmail}.
        </p>
      </div>
    </main>
  );
}
