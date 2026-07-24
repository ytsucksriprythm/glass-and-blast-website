import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getInvoiceByToken, updateInvoice, getSettings } from '@/lib/db';
import { cardTotal, money } from '@/lib/invoice';
import { createSquarePaymentLink, squareConfigured } from '@/lib/square';
import type { AppSettings } from '@/lib/settings';
import InvoicePreview from '@/components/InvoicePreview';
import PrintButton from '@/components/PrintButton';
import InvoiceViewBeacon from '@/components/InvoiceViewBeacon';
import MarkPaidButton from '@/components/MarkPaidButton';
import PayByCardButton from '@/components/PayByCardButton';
import type { Invoice } from '@/lib/invoice';

// Lazily create (or refresh, if the total has drifted) the Square payment
// link the first time an unpaid invoice is viewed publicly. Best-effort: if
// Square is unreachable or unconfigured, the invoice still renders fine with
// just the bank-transfer option.
async function ensureSquareLink(invoice: Invoice, settings: AppSettings): Promise<Invoice> {
  if (!settings.squareCardPaymentsEnabled) return invoice;
  if (invoice.status === 'paid' || invoice.status === 'cancelled' || !squareConfigured()) return invoice;
  const amount = cardTotal(invoice.total, settings.squareSurchargePercent);
  if (invoice.squarePaymentLinkUrl && invoice.squareLinkAmount != null && Math.abs(invoice.squareLinkAmount - amount) < 0.01) {
    return invoice;
  }
  try {
    const origin = process.env.NEXT_PUBLIC_URL || '';
    const link = await createSquarePaymentLink(invoice, amount, `${origin}/invoice/${invoice.token}`);
    if (!link) return invoice;
    const updated = await updateInvoice(invoice.id, {
      squarePaymentLinkUrl: link.url, squareOrderId: link.orderId, squareLinkAmount: amount,
    });
    return updated ?? invoice;
  } catch (err) {
    console.error('Square link lazy-create failed:', err);
    return invoice;
  }
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) return { title: 'Invoice not found' };
  const title = invoice.isTaxInvoice ? 'Tax Invoice' : 'Invoice';
  return {
    title: `${title} ${invoice.number} - ${invoice.fromTradingAs}`,
    robots: { index: false, follow: false }, // private link, keep out of search
  };
}

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invoice = await getInvoiceByToken(token);
  if (!invoice) notFound();
  const settings = await getSettings();
  invoice = await ensureSquareLink(invoice, settings);

  const canPayByCard = settings.squareCardPaymentsEnabled && invoice.status !== 'paid' && invoice.status !== 'cancelled' && !!invoice.squarePaymentLinkUrl;

  return (
    <main className="invoice-page min-h-[100svh] bg-slate-100 py-6 sm:py-12 px-3 sm:px-6">
      <InvoiceViewBeacon token={invoice.token} />
      <div className="mx-auto w-full" style={{ maxWidth: '820px' }}>
        <div className="no-print mb-4 flex items-center justify-between flex-wrap gap-2">
          <span className="text-slate-500 text-sm">
            {invoice.isTaxInvoice ? 'Tax Invoice' : 'Invoice'} {invoice.number}
          </span>
          <div className="flex items-center gap-2">
            <PrintButton />
            {invoice.status !== 'paid' && <MarkPaidButton token={invoice.token} />}
          </div>
        </div>
        {canPayByCard && (
          <PayByCardButton
            token={invoice.token}
            href={invoice.squarePaymentLinkUrl!}
            label={`Pay by card — ${money(cardTotal(invoice.total, settings.squareSurchargePercent))} (incl. card surcharge)`}
          />
        )}
        <div className="rounded-xl shadow-lg ring-1 ring-slate-200 overflow-hidden">
          <InvoicePreview invoice={{ ...invoice, paid: invoice.status === 'paid', paymentMethod: invoice.paymentMethod, cardPayable: canPayByCard, surchargePercent: settings.squareSurchargePercent }} />
        </div>
        <p className="no-print mt-6 text-center text-slate-400 text-xs">
          Questions about this invoice? Call {invoice.fromPhone} or email {invoice.fromEmail}.
        </p>
      </div>
    </main>
  );
}
