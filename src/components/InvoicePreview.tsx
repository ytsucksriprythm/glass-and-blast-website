import { type Invoice, type PaymentMethod, PAYMENT_METHOD_LABEL, SQUARE_SURCHARGE_PERCENT_FALLBACK, cardTotal, money, longDate, shortDate, computeTotals, GST_NOTE } from '@/lib/invoice';

// The display fields the preview needs. The live editor passes a synthesized
// object (number may be a placeholder) before the invoice is saved. `paid` /
// `paymentMethod` are surfaced separately (rather than via the full Invoice
// `status`) since the live editor's unsaved draft has no real status yet.
export type InvoicePreviewData = Omit<
  Invoice,
  'id' | 'seq' | 'token' | 'bookingId' | 'bookingIds' | 'ownerGuestId' | 'createdAt' | 'updatedAt' | 'sentAt' | 'paidAt' | 'status' | 'paymentMethod'
  | 'viewCount' | 'firstViewedAt' | 'lastViewedAt'
  | 'squarePaymentLinkUrl' | 'squareOrderId' | 'squarePaymentId' | 'squareLinkAmount' | 'squarePaidAt'
> & {
  paid?: boolean;
  paymentMethod?: PaymentMethod | null;
  cardPayable?: boolean;  // a live Square payment link exists for this invoice
  surchargePercent?: number;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium text-right">{value}</span>
    </div>
  );
}

/**
 * Paper invoice. Always light-themed (white sheet, dark text) regardless of the
 * surrounding app theme, so it looks the same in the dark admin editor and on
 * the public page, and prints cleanly.
 */
export default function InvoicePreview({ invoice }: { invoice: InvoicePreviewData }) {
  const title = invoice.isTaxInvoice ? 'Tax Invoice' : 'Invoice';
  const { subtotal, total } = computeTotals(invoice.items);
  const ref = invoice.number;

  return (
    <div className="invoice-sheet bg-white text-slate-900 mx-auto w-full" style={{ maxWidth: '820px' }}>
      <div className="p-6 sm:p-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-sky-600 pb-5">
          <div>
            <div className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              {invoice.fromTradingAs || 'Glass and Blast'}
            </div>
            <div className="text-slate-500 text-xs sm:text-sm mt-1">
              Window Cleaning &nbsp;|&nbsp; North Canberra &amp; Greater ACT
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-slate-900">
              {title}
            </div>
            <div className="text-sky-700 font-semibold mt-1">{invoice.number}</div>
            {invoice.paid && (
              <div className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-md border-2 border-emerald-600 text-emerald-700 font-display font-extrabold uppercase tracking-widest text-sm -rotate-3">
                Paid
              </div>
            )}
          </div>
        </div>

        {/* From + meta */}
        <div className="grid sm:grid-cols-2 gap-6 mt-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">From</div>
            <div className="text-slate-900 font-semibold">{invoice.fromName}</div>
            {invoice.fromTradingAs && <div className="text-slate-600 text-sm">Trading as {invoice.fromTradingAs}</div>}
            {invoice.fromAbn && <div className="text-slate-600 text-sm">ABN: {invoice.fromAbn}</div>}
            {invoice.fromAddress && <div className="text-slate-600 text-sm">{invoice.fromAddress}</div>}
            {invoice.fromEmail && <div className="text-slate-600 text-sm">{invoice.fromEmail}</div>}
            {invoice.fromPhone && <div className="text-slate-600 text-sm">{invoice.fromPhone}</div>}
          </div>
          <div className="sm:pl-6">
            {invoice.invoiceDate && <Field label="Invoice date" value={longDate(invoice.invoiceDate)} />}
            {invoice.serviceDate && <Field label="Service date" value={longDate(invoice.serviceDate)} />}
            {invoice.dueDate && <Field label="Due date" value={longDate(invoice.dueDate)} />}
          </div>
        </div>

        {/* Bill to */}
        {(invoice.billToName || invoice.billToLines) && (
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Bill to</div>
            {invoice.billToName && <div className="text-slate-900 font-semibold">{invoice.billToName}</div>}
            {invoice.billToLines && (
              <div className="text-slate-600 text-sm whitespace-pre-line">{invoice.billToLines}</div>
            )}
          </div>
        )}

        {/* Optional client details block (DVA / government) */}
        {invoice.client?.show && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Client details</div>
            <div className="grid sm:grid-cols-2 gap-x-6">
              {invoice.client.clientName && <Field label="Client name" value={invoice.client.clientName} />}
              {invoice.client.trn && <Field label="TRN" value={invoice.client.trn} />}
              {invoice.client.fileNo && <Field label="File no." value={invoice.client.fileNo} />}
              {invoice.client.claimRef && <Field label="Claim reference" value={invoice.client.claimRef} />}
            </div>
          </div>
        )}

        {/* Line items */}
        <div className="mt-8 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold w-28 whitespace-nowrap">Date</th>
                <th className="px-4 py-2.5 font-semibold text-right w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    <div className="text-slate-900 font-medium">{it.description || '-'}</div>
                    {it.detail && <div className="text-slate-500 text-xs mt-1 whitespace-pre-line">{it.detail}</div>}
                    {it.serviceAddress && (
                      <div className="text-slate-500 text-xs mt-1">Service address: {it.serviceAddress}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{shortDate(it.date)}</td>
                  <td className="px-4 py-3 text-right text-slate-900 font-medium whitespace-nowrap">{money(it.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="mt-5 flex justify-end">
          <div className="w-full sm:w-72">
            <div className="flex justify-between py-1 text-sm text-slate-600">
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between py-1 text-sm text-slate-600">
              <span>GST</span><span>$0.00</span>
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t-2 border-slate-900 text-base font-bold text-slate-900">
              <span>Total due</span><span>{money(total)} AUD</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-right text-xs text-slate-400 italic">{GST_NOTE}</p>

        {/* Payment details */}
        {invoice.paid ? (
          <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-2">Payment received</div>
            <p className="text-sm text-emerald-900">
              This invoice has been paid in full
              {invoice.paymentMethod ? <> via <span className="font-bold">{PAYMENT_METHOD_LABEL[invoice.paymentMethod]}</span></> : ''}.
              Thank you — this document serves as your receipt.
            </p>
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-sky-200 bg-sky-50 p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-700 mb-2">Payment details</div>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
              <Field label="Account name" value={invoice.payAccountName} />
              <Field label="BSB" value={invoice.payBsb} />
              <Field label="Account number" value={invoice.payAccountNumber} />
              <Field label="Payment reference" value={<span className="text-sky-800 font-bold">{ref}</span>} />
            </div>
            <p className="mt-3 text-sm text-sky-900">
              Please pay by bank transfer and use <span className="font-bold">{ref}</span> as the payment reference so we
              can match your payment.
            </p>
            {invoice.cardPayable && (
              <p className="mt-2 text-sm text-sky-900">
                Prefer to pay by card? Use the &quot;Pay by card&quot; button on this page (a {invoice.surchargePercent ?? SQUARE_SURCHARGE_PERCENT_FALLBACK}% card
                surcharge applies, total <span className="font-bold">{money(cardTotal(total, invoice.surchargePercent))}</span>).
              </p>
            )}
          </div>
        )}

        {/* Footer */}
        {invoice.notes && <p className="mt-6 text-center text-slate-600 text-sm">{invoice.notes}</p>}
        <p className="mt-2 text-center text-slate-400 text-xs">
          {invoice.fromTradingAs || 'Glass and Blast'} &nbsp;|&nbsp; Best Window Cleaner North Canberra &nbsp;|&nbsp; 5.0 Rated
        </p>
      </div>
    </div>
  );
}
