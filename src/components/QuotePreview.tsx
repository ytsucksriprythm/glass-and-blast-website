import { Check } from 'lucide-react';
import { X } from 'lucide-react';
import {
  type Quote, serviceLabel, sortServiceKeys, money, longDate, quoteDiscountBreakdown, paymentTermsText,
  isPackageQuote, quoteForPackage, discountLines, fromCents, PACKAGE_KEYS, PACKAGE_INFO, PACKAGE_INCLUSIONS,
} from '@/lib/quote';

// Display fields QuotePreview needs. The modal's live (unsaved) draft passes
// a synthesized object (number/token may be placeholders) before the quote
// is saved — same idea as InvoicePreviewData.
export type QuotePreviewData = Omit<Quote, 'id' | 'seq' | 'token' | 'bookingId' | 'createdAt' | 'updatedAt' | 'sentAt'>;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-1 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium text-right">{value}</span>
    </div>
  );
}

/**
 * Paper quote. Always light-themed, same spirit as InvoicePreview — looks the
 * same in the dark admin modal and on the public page, and prints cleanly.
 * Each checked service/extra (and the Other line) carries its own price —
 * see quoteTotal() in lib/quote.ts for how the total is derived. Still no
 * payment/bank block (that's paymentTerms, below, not a Square/EFT block).
 */
export default function QuotePreview({ quote: raw }: { quote: QuotePreviewData }) {
  // Three-package quote with a package picked: show it as that one package
  // (price line + discount lines). See quoteForPackage in lib/quote.ts.
  const pkg = isPackageQuote(raw) ? raw.selectedPackage ?? null : null;
  const quote = pkg ? quoteForPackage(raw, pkg) : raw;
  const packagesUnpicked = isPackageQuote(raw) && !pkg;
  const items: { label: string; amount: number }[] = [
    ...sortServiceKeys(quote.services).map(k => ({ label: serviceLabel(k), amount: Number(quote.itemAmounts?.[k]) || 0 })),
    ...quote.extras.map(k => ({ label: serviceLabel(k), amount: Number(quote.itemAmounts?.[k]) || 0 })),
    ...(quote.otherLines ?? [])
      .filter(l => l.description.trim() || l.amount)
      .map(l => ({ label: l.description.trim() || 'Other', amount: Number(l.amount) || 0 })),
  ];
  const { beforeDiscount, discount, total } = quoteDiscountBreakdown(quote);

  return (
    <div className="quote-sheet bg-white text-slate-900 mx-auto w-full" style={{ maxWidth: '820px' }}>
      <div className="p-6 sm:p-10">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-sky-600 pb-5">
          <div>
            <div className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
              {quote.fromTradingAs || 'Glass and Blast'}
            </div>
            <div className="text-slate-500 text-xs sm:text-sm mt-1">
              Window Cleaning &nbsp;|&nbsp; Canberra, Queanbeyan &amp; Googong
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-xl sm:text-2xl font-bold uppercase tracking-wider text-slate-900">
              Quote
            </div>
            <div className="text-sky-700 font-semibold mt-1">{quote.number}</div>
            {quote.validUntil && (
              <div className="inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-md border border-slate-300 text-slate-600 font-semibold text-xs">
                Valid until {longDate(quote.validUntil)}
              </div>
            )}
          </div>
        </div>

        {/* From + meta */}
        <div className="grid sm:grid-cols-2 gap-6 mt-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">From</div>
            <div className="text-slate-900 font-semibold">{quote.fromName}</div>
            {quote.fromTradingAs && <div className="text-slate-600 text-sm">Trading as {quote.fromTradingAs}</div>}
            {quote.fromAbn && <div className="text-slate-600 text-sm">ABN: {quote.fromAbn}</div>}
            {quote.showFromAddress && quote.fromAddress && <div className="text-slate-600 text-sm">{quote.fromAddress}</div>}
            {quote.fromEmail && <div className="text-slate-600 text-sm">{quote.fromEmail}</div>}
            {quote.fromPhone && <div className="text-slate-600 text-sm">{quote.fromPhone}</div>}
          </div>
          <div className="sm:pl-6">
            {quote.quoteDate && <Field label="Quote date" value={longDate(quote.quoteDate)} />}
            {quote.propertyType && <Field label="Property" value={quote.propertyType === 'commercial' ? 'Commercial' : 'Residential'} />}
          </div>
        </div>

        {/* Prepared for */}
        {(quote.billToName || quote.billToAddress) && (
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Prepared for</div>
            {quote.billToName && <div className="text-slate-900 font-semibold">{quote.billToName}</div>}
            {quote.billToAddress && <div className="text-slate-600 text-sm whitespace-pre-line">{quote.billToAddress}</div>}
          </div>
        )}

        {/* Three-package, none picked yet (admin preview / copied text) */}
        {packagesUnpicked && (
          <div className="mt-8 rounded-lg border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Packages · window cleaning (inside &amp; outside)
            </div>
            <div className="divide-y divide-slate-100">
              {PACKAGE_KEYS.map(k => (
                <div key={k} className="px-4 py-2.5 flex items-center gap-2.5 text-sm">
                  <span className="text-slate-900 flex-1">{PACKAGE_INFO[k].name}</span>
                  <span className="font-medium text-slate-900">{money(fromCents(raw.packagePrices?.[k] ?? 0))}</span>
                </div>
              ))}
              {discountLines(raw).map(l => (
                <div key={l.id} className="px-4 py-2.5 flex items-center gap-2.5 text-sm">
                  <span className="text-slate-600 flex-1">{l.description.trim() || 'Discount'} (off whichever is chosen)</span>
                  <span className="font-medium text-emerald-700">{money(l.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Itemised services */}
        {!packagesUnpicked && <div className="mt-8 rounded-lg border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Services
          </div>
          <div className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <div className="px-4 py-3 text-slate-400 text-sm">No services selected</div>
            ) : items.map((it, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 text-sm">
                <Check className="w-4 h-4 text-sky-600 flex-shrink-0" />
                <span className="text-slate-900 flex-1">{it.label}</span>
                <span className={`font-medium ${it.amount < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>{money(it.amount)}</span>
              </div>
            ))}
          </div>
        </div>}

        {/* What the chosen package includes — same 8 rows as the cards */}
        {pkg && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Included in {PACKAGE_INFO[pkg].name}</div>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {PACKAGE_INCLUSIONS.map(row => {
                const on = row.in.includes(pkg);
                return (
                  <li key={row.label} className="flex items-center gap-2 text-sm">
                    {on ? <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <X className="w-4 h-4 text-slate-300 flex-shrink-0" />}
                    <span className={on ? 'text-slate-800' : 'text-slate-400'}>{row.label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Scope of work */}
        {quote.scope?.trim() && (
          <div className="mt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Scope of work</div>
            <p className="text-slate-700 text-sm whitespace-pre-line">{quote.scope.trim()}</p>
          </div>
        )}

        {/* Total */}
        {!packagesUnpicked && <div className="mt-5 flex justify-end">
          <div className="w-full sm:w-72 text-right">
            {discount < 0 ? (
              <>
                <div className="flex justify-between pt-2 border-t-2 border-slate-900 text-base font-bold text-slate-900">
                  <span>Total</span><span className="line-through decoration-2">{money(beforeDiscount)} AUD</span>
                </div>
                <div className="flex justify-between mt-1 text-sm font-medium text-emerald-700">
                  <span>Discount</span><span>{money(discount)}</span>
                </div>
                <div className="flex justify-between mt-1.5 text-xl font-extrabold text-slate-900">
                  <span>You pay</span><span>{money(total)} AUD</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between pt-2 border-t-2 border-slate-900 text-base font-bold text-slate-900">
                <span>Total</span><span>{money(total)} AUD</span>
              </div>
            )}
          </div>
        </div>}

        {/* Assumptions */}
        {quote.assumptions?.trim() && (
          <div className="mt-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Assumptions this quote is based on</div>
            <p className="text-slate-600 text-xs whitespace-pre-line">{quote.assumptions.trim()}</p>
          </div>
        )}

        {/* Payment terms */}
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Payment terms</div>
          <p className="text-slate-600 text-xs whitespace-pre-line">{paymentTermsText(quote.paymentTerms)}</p>
        </div>

        {/* Terms */}
        {quote.termsText && (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-600 whitespace-pre-line">{quote.termsText}</p>
          </div>
        )}

        {/* Footer */}
        {quote.notes && <p className="mt-6 text-center text-slate-600 text-sm">{quote.notes}</p>}
        <p className="mt-2 text-center text-slate-400 text-xs">
          {quote.fromTradingAs || 'Glass and Blast'} &nbsp;|&nbsp; Best Window Cleaner North Canberra &nbsp;|&nbsp; 5.0 Rated
        </p>
      </div>
    </div>
  );
}
