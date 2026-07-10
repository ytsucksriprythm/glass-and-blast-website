import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getInvoiceByToken } from '@/lib/db';
import InvoicePreview from '@/components/InvoicePreview';
import PrintButton from '@/components/PrintButton';
import InvoiceViewBeacon from '@/components/InvoiceViewBeacon';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) return { title: 'Invoice not found' };
  const title = invoice.isTaxInvoice ? 'Tax Invoice' : 'Invoice';
  return {
    title: `${title} ${invoice.number} — ${invoice.fromTradingAs}`,
    robots: { index: false, follow: false }, // private link, keep out of search
  };
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) notFound();

  return (
    <main className="invoice-page min-h-[100svh] bg-slate-100 py-6 sm:py-12 px-3 sm:px-6">
      <InvoiceViewBeacon token={invoice.token} />
      <div className="mx-auto w-full" style={{ maxWidth: '820px' }}>
        <div className="no-print mb-4 flex items-center justify-between">
          <span className="text-slate-500 text-sm">
            {invoice.isTaxInvoice ? 'Tax Invoice' : 'Invoice'} {invoice.number}
          </span>
          <PrintButton />
        </div>
        <div className="rounded-xl shadow-lg ring-1 ring-slate-200 overflow-hidden">
          <InvoicePreview invoice={invoice} />
        </div>
        <p className="no-print mt-6 text-center text-slate-400 text-xs">
          Questions about this invoice? Call {invoice.fromPhone} or email {invoice.fromEmail}.
        </p>
      </div>
    </main>
  );
}
