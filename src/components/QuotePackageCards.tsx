import { Check, X } from 'lucide-react';
import { PACKAGE_KEYS, PACKAGE_INFO, PACKAGE_INCLUSIONS, fromCents, money, type PackageKey, type PackagePricesCents } from '@/lib/quote';

/**
 * The three package cards for a three-package quote. Used on the customer's
 * quote page (with links to pick one) and in the admin modal's live preview
 * (no links). Prices are before discounts on purpose: discounts only show on
 * the formal quote once a package is picked. Nothing is pre-selected.
 */
export default function QuotePackageCards({ prices, hrefFor, stacked = false }: {
  prices: PackagePricesCents | null | undefined;
  hrefFor?: (k: PackageKey) => string;
  stacked?: boolean;  // always one column (the admin modal's narrow preview pane)
}) {
  return (
    <div className={`grid gap-4 ${stacked ? 'pt-3' : 'md:grid-cols-3 md:items-stretch'}`}>
      {PACKAGE_KEYS.map(k => {
        const premium = k === 'premium';
        return (
          <div
            key={k}
            className={`relative flex flex-col rounded-2xl bg-white p-5 sm:p-6 ${premium
              ? `ring-2 ring-sky-600 shadow-xl shadow-sky-900/10 ${stacked ? '' : 'md:-my-2 md:py-8'}`
              : 'ring-1 ring-slate-200 shadow-sm'}`}
          >
            {premium && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                Most comprehensive
              </span>
            )}
            <h3 className="font-display text-xl font-extrabold text-slate-900">{PACKAGE_INFO[k].name}</h3>
            <div className="mt-2 font-display text-3xl font-extrabold text-slate-900">
              {money(fromCents(prices?.[k] ?? 0))}
              <span className="ml-1 text-sm font-semibold text-slate-400">AUD</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{PACKAGE_INFO[k].description}</p>
            <ul className="mt-4 space-y-2 flex-1">
              {PACKAGE_INCLUSIONS.map(row => {
                const on = row.in.includes(k);
                return (
                  <li key={row.label} className="flex items-start gap-2 text-sm">
                    {on
                      ? <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" aria-label="Included" />
                      : <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-300" aria-label="Not included" />}
                    <span className={on ? 'text-slate-800' : 'text-slate-400'}>{row.label}</span>
                  </li>
                );
              })}
            </ul>
            {hrefFor ? (
              <a
                href={hrefFor(k)}
                className={`mt-6 block rounded-xl px-4 py-3 text-center text-sm font-bold transition-colors ${premium
                  ? 'bg-sky-600 text-white hover:bg-sky-700'
                  : 'bg-slate-900 text-white hover:bg-slate-800'}`}
              >
                Select Package
              </a>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-center text-sm font-semibold text-slate-400">
                Select Package
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
