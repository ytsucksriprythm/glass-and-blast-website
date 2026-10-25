// Quote types and pure helpers. No `fs`/`neon` imports here so this module is
// safe to import from client components (the modal + preview) as well as
// server code (db + the public page) — same rule as invoice.ts.
//
// A Quote is deliberately simpler than an Invoice: one lump-sum `amount`
// (no itemized line items), admin-only (no guest ownership, no Square/payment
// block), and no view tracking (not requested — see TRANSFER.md).

import {
  money, addDays, longDate, GST_NOTE,
  type PaymentDueTerms, PAYMENT_DUE_TERMS_OPTIONS, DEFAULT_PAYMENT_DUE_TERMS, isPaymentDueTerms, paymentTermsText,
} from './invoice';

export type QuoteStatus = 'draft' | 'sent';

// Window cleaning prices inside and outside separately. Outside is the base
// service; inside is a bolt-on add-on, never sold alone — see the
// WINDOW_INSIDE_KEY/WINDOW_OUTSIDE_KEY enforcement in QuoteModal (checking
// Inside pulls Outside in with it, unchecking Outside drops Inside too).
// Listed in this order (outside, then inside) so it reads base-then-addon
// everywhere this array drives display order — see sortServiceKeys() below.
export const QUOTE_SERVICE_OPTIONS = [
  { key: 'window-washing-outside', label: 'Window Cleaning - Outside' },
  { key: 'window-washing-inside', label: 'Window Cleaning - Inside (add-on, requires Outside)' },
  { key: 'pressure-washing', label: 'Pressure Washing' },
  { key: 'solar-panel-cleaning', label: 'Solar Panel Cleaning' },
] as const;

export const WINDOW_OUTSIDE_KEY = 'window-washing-outside';
export const WINDOW_INSIDE_KEY = 'window-washing-inside';

// Old quotes saved before the inside/outside split still carry the single
// 'window-washing' key in their `services` array — no longer in the options
// list above, so serviceLabel() needs to keep recognising it by hand or a
// years-old quote would render with the raw key instead of a real label.
const LEGACY_SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Cleaning',
};

// Services/extras render in QUOTE_SERVICE_OPTIONS/QUOTE_EXTRA_OPTIONS order
// wherever they're listed on the document, regardless of the order they were
// checked in — matters most for Outside always appearing above Inside, so
// the add-on relationship reads correctly on the actual quote.
export function sortServiceKeys(keys: string[]): string[] {
  const index = (k: string) => {
    const i = QUOTE_SERVICE_OPTIONS.findIndex(o => o.key === k);
    if (i !== -1) return i;
    const j = QUOTE_EXTRA_OPTIONS.findIndex(o => o.key === k);
    return j !== -1 ? QUOTE_SERVICE_OPTIONS.length + j : 999;
  };
  return [...keys].sort((a, b) => index(a) - index(b));
}

export const QUOTE_EXTRA_OPTIONS = [
  { key: 'flyscreen-repair', label: 'Flyscreen Repair' },
  { key: 'gutter-cleaning', label: 'Gutter Cleaning' },
  { key: 'rain-repellent', label: 'Rain Repellent Treatment' },
] as const;
// Note: 'flyscreen-repair' coincidentally matches a Booking ServiceType value
// (src/lib/db.ts) — that's a bare string match, not a shared type. Quote.extras
// is never validated against, or written into, Booking.service.

// One or more custom lines for anything not covered by the fixed
// services/extras — added with a "+" button, each with its own description
// and price (unlike services/extras, which price via Quote.itemAmounts).
export interface QuoteOtherLine {
  id: string;
  description: string;
  amount: number;
}

export function emptyOtherLine(): QuoteOtherLine {
  return { id: `ol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, description: '', amount: 0 };
}

export function serviceLabel(key: string): string {
  return QUOTE_SERVICE_OPTIONS.find(o => o.key === key)?.label
    ?? QUOTE_EXTRA_OPTIONS.find(o => o.key === key)?.label
    ?? LEGACY_SERVICE_LABELS[key]
    ?? key;
}

// Payment terms aren't free text: we don't take card, so it's always cash on
// completion or bank transfer against the invoice — the only thing that
// varies is how long they have to pay that invoice. See PAYMENT_DUE_TERMS_OPTIONS
// in invoice.ts (re-exported below) for the fixed set of choices.

export interface Quote {
  id: string;              // QT-<timestamp>
  number: string;          // Q1000, Q1001, ... sequential (atomic counter, mirrors invoice numbering)
  seq: number;
  token: string;            // unguessable public-link token, qt_<24 hex>
  bookingId: string;        // a quote is for exactly one job (unlike invoices' bookingIds[])
  status: QuoteStatus;      // 'draft' on create; flips to 'sent' as a side effect of Copy/Share

  services: string[];       // subset of QUOTE_SERVICE_OPTIONS keys
  extras: string[];         // subset of QUOTE_EXTRA_OPTIONS keys
  itemAmounts: Record<string, number>;  // price per checked service/extra key
  otherLines: QuoteOtherLine[];  // custom lines, each with its own description + price
  amount: number;           // total, derived from itemAmounts + otherLines — see quoteTotal()

  scope: string;            // what's actually included: window/area counts, in/out, storeys, exclusions
  assumptions: string;      // conditions assumed when quoting (access, condition, etc.) — protects both sides if reality differs
  paymentTerms: PaymentDueTerms;  // how long they have to pay once invoiced — see paymentTermsText(). Carried over to autofill the eventual invoice's dueDate.

  propertyType: 'residential' | 'commercial';
  billToName: string;
  billToAddress: string;

  // FROM (business) — editable per quote, pre-filled from BUSINESS_DEFAULTS
  fromName: string;
  fromTradingAs: string;
  fromAbn: string;
  fromAddress: string;
  fromEmail: string;
  fromPhone: string;
  // Whether fromAddress renders on the quote document. Unlike Invoice there's
  // no tax-invoice-style forced override — a quote is never a tax invoice.
  showFromAddress: boolean;

  quoteDate: string;        // YYYY-MM-DD
  validUntil: string;       // YYYY-MM-DD, quoteDate + QUOTE_VALID_DAYS by default

  notes: string;            // optional customer-facing note
  termsText: string;        // legal boilerplate, defaulted, editable per quote

  createdAt: string;
  updatedAt: string;
  sentAt: string | null;

  // Three-package quotes (see PACKAGE_INFO below). All optional so quotes
  // saved before this existed read as Single, unchanged.
  quoteType?: QuoteType;                       // absent = 'single'
  packagePrices?: PackagePricesCents | null;   // integer cents, fixed when saved
  selectedPackage?: PackageKey | null;         // set when the customer accepts
  acceptedAt?: string | null;
}

// Everything the create endpoint accepts; the store fills in the rest
// (id, number, seq, token, timestamps).
export type QuoteInput = Omit<Quote, 'id' | 'number' | 'seq' | 'token' | 'createdAt' | 'updatedAt' | 'sentAt' | 'status' | 'selectedPackage' | 'acceptedAt'> & {
  status?: QuoteStatus;
};

export const QUOTE_PREFIX = 'Q';
export const QUOTE_START_SEQ = 1000;
export const QUOTE_VALID_DAYS = 30;

export const DEFAULT_QUOTE_TERMS =
  'No GST has been charged. ' +
  `This price is valid for ${QUOTE_VALID_DAYS} days from the quote date above. After that, please ask us to reissue it. ` +
  "The final price may change if the property's condition or access differs from what was described or observed at the time of quoting, or from the assumptions stated above. " +
  'We will always confirm any change with you before the job starts.';

// Checkbox presets for Scope of Work / Assumptions — the modal lets the admin
// tick boxes to build these up sentence-by-sentence, or drop in their own
// text via a "Custom" box that overrides (negates) whatever's checked. Order
// here is the order the generated text renders in, not click order.
export interface TextPreset { key: string; label: string; text: string; }

export const SCOPE_PRESETS: TextPreset[] = [
  { key: 'inside', label: 'Inside windows', text: 'Inside glass surfaces cleaned.' },
  { key: 'outside', label: 'Outside windows', text: 'Outside glass surfaces cleaned.' },
  { key: 'tracks', label: 'Window tracks & sills', text: 'Window tracks and sills wiped down as a complimentary extra. This does not include removal of heavy built-up grime or caked-on dirt.' },
  { key: 'flyscreens', label: 'Flyscreens (cleaned in place)', text: 'Flyscreens cleaned in place, not removed.' },
  { key: 'gutters', label: 'Gutters', text: 'Gutters cleared of leaves and debris.' },
  { key: 'solar', label: 'Solar panels', text: 'Solar panels cleaned with pure water, no harsh chemicals.' },
  { key: 'driveway', label: 'Driveway / paths', text: 'Driveway and paths pressure washed.' },
  { key: 'singleStorey', label: 'Single storey / ground level only', text: 'Ground-level, single-storey access only, upper storeys not included unless stated otherwise.' },
  { key: 'excludesStaining', label: 'Excludes hard water/mineral staining', text: "Does not include removal of hard water marks, mineral deposits, or restoration of scratched or otherwise damaged glass." },
];

export const ASSUMPTION_PRESETS: TextPreset[] = [
  { key: 'groundAccess', label: 'Ground-level access assumed', text: 'Assumed ground-level access with no ladder or scaffolding beyond a standard extension pole.' },
  { key: 'normalCondition', label: 'Normal condition, no excessive buildup', text: 'Assumed the property is in normal condition with no excessive dirt, mineral buildup, or damage beyond normal wear.' },
  { key: 'accessible', label: 'Property accessible on the day', text: 'Assumed all areas to be cleaned are accessible on the day (gates unlocked, pets restrained, vehicles moved if needed).' },
  { key: 'weather', label: 'Weather permitting', text: 'Weather permitting, the job may need to be rescheduled in unsafe conditions (high wind, rain, storms), especially for height or solar work.' },
  { key: 'countAccuracy', label: 'Price assumes the stated window/pane count is accurate', text: "Assumed the window/pane count and property size described match what's on site; the price may be revised if it differs." },
  { key: 'preExistingDamage', label: 'No responsibility for pre-existing damage', text: "We're not responsible for pre-existing damage (cracked glass, loose flyscreens, failed seals) not caused by our work." },
];

// All of them, by default — every one is a genuine protection worth having
// on every quote; unchecking one is a deliberate per-quote choice.
export const DEFAULT_ASSUMPTION_PRESET_KEYS = ASSUMPTION_PRESETS.map(p => p.key);

export function buildFromPresets(presets: TextPreset[], checkedKeys: string[]): string {
  return presets.filter(p => checkedKeys.includes(p.key)).map(p => p.text).join(' ');
}

export const DEFAULT_QUOTE_ASSUMPTIONS = buildFromPresets(ASSUMPTION_PRESETS, DEFAULT_ASSUMPTION_PRESET_KEYS);

// Sum of the per-item prices in itemAmounts for whichever services/extras are
// actually checked (unchecking one drops its price from the total even if a
// $ figure is still sitting in the map), plus every custom Other line.
export function quoteTotal(q: Pick<Quote, 'services' | 'extras' | 'itemAmounts' | 'otherLines'>): number {
  const checkedSum = [...q.services, ...q.extras].reduce((sum, k) => sum + (Number(q.itemAmounts?.[k]) || 0), 0);
  const otherSum = (q.otherLines ?? []).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  return checkedSum + otherSum;
}

// Splits the total into the price before discounts and the discounts (all the
// negative lines, e.g. "Meta ads discount -100"). discount is <= 0; when it's
// 0 there's nothing to show crossed out.
export function quoteDiscountBreakdown(q: Pick<Quote, 'services' | 'extras' | 'itemAmounts' | 'otherLines'>): { beforeDiscount: number; discount: number; total: number } {
  const amounts = [
    ...[...q.services, ...q.extras].map(k => Number(q.itemAmounts?.[k]) || 0),
    ...(q.otherLines ?? []).map(l => Number(l.amount) || 0),
  ];
  const discount = amounts.filter(a => a < 0).reduce((s, a) => s + a, 0);
  const total = quoteTotal(q);
  return { beforeDiscount: total - discount, discount, total };
}

export function emptyQuoteDraft(fromDefaults: { fromName: string; fromTradingAs: string; fromAbn: string; fromAddress: string; fromEmail: string; fromPhone: string }, todayStr: string): QuoteInput {
  return {
    bookingId: '',
    services: [],
    extras: [],
    itemAmounts: {},
    otherLines: [],
    amount: 0,
    scope: '',
    assumptions: DEFAULT_QUOTE_ASSUMPTIONS,
    paymentTerms: DEFAULT_PAYMENT_DUE_TERMS,
    propertyType: 'residential',
    billToName: '',
    billToAddress: '',
    showFromAddress: true,
    ...fromDefaults,
    quoteDate: todayStr,
    validUntil: addDays(todayStr, QUOTE_VALID_DAYS),
    notes: '',
    termsText: DEFAULT_QUOTE_TERMS,
  };
}

// The plain-text copyable version — one source of truth used by both the
// admin "Copy text" button and the public page's Copy button.
export function buildQuoteText(quote: Pick<Quote,
  'number' | 'fromTradingAs' | 'fromName' | 'fromAbn' | 'fromPhone' | 'fromEmail' | 'billToName' | 'billToAddress' |
  'quoteDate' | 'validUntil' | 'services' | 'extras' | 'itemAmounts' | 'otherLines' | 'amount' |
  'scope' | 'assumptions' | 'paymentTerms' | 'termsText'
> & Partial<Pick<Quote, 'quoteType' | 'packagePrices' | 'selectedPackage'>>): string {
  // Package quote with a package picked: price it as that one package. With
  // none picked yet, list all three instead of a total.
  const pkg = isPackageQuote(quote) ? quote.selectedPackage ?? null : null;
  if (pkg) quote = quoteForPackage(quote, pkg);
  const lines: string[] = [];
  lines.push(`QUOTE ${quote.number} · ${quote.fromTradingAs || 'Glass and Blast'}`);
  if (quote.fromAbn) lines.push(`ABN: ${quote.fromAbn}`);
  lines.push('');
  if (quote.quoteDate) lines.push(`Date: ${longDate(quote.quoteDate)}`);
  if (quote.validUntil) lines.push(`Valid until: ${longDate(quote.validUntil)}`);
  if (quote.billToName || quote.billToAddress) {
    lines.push('');
    lines.push('Prepared for:');
    if (quote.billToName) lines.push(quote.billToName);
    if (quote.billToAddress) lines.push(quote.billToAddress);
  }
  const items: [string, number][] = [
    ...sortServiceKeys(quote.services).map((k): [string, number] => [serviceLabel(k), Number(quote.itemAmounts?.[k]) || 0]),
    ...quote.extras.map((k): [string, number] => [serviceLabel(k), Number(quote.itemAmounts?.[k]) || 0]),
    ...(quote.otherLines ?? [])
      .filter(l => l.description.trim() || l.amount)
      .map((l): [string, number] => [l.description.trim() || 'Other', Number(l.amount) || 0]),
  ];
  if (isPackageQuote(quote) && !pkg) {
    lines.push('');
    lines.push('Choose a package (window cleaning, inside & outside):');
    for (const k of PACKAGE_KEYS) lines.push(`- ${PACKAGE_INFO[k].name}: ${money(fromCents(quote.packagePrices?.[k] ?? 0))}`);
    for (const l of discountLines(quote)) lines.push(`${l.description.trim() || 'Discount'} (off whichever you choose): ${money(l.amount)}`);
  } else if (items.length) {
    lines.push('');
    lines.push('Services:');
    for (const [label, amt] of items) lines.push(`- ${label}: ${money(amt)}`);
  }
  if (pkg) {
    lines.push('');
    lines.push(`Included in ${PACKAGE_INFO[pkg].name}:`);
    for (const row of PACKAGE_INCLUSIONS) if (row.in.includes(pkg)) lines.push(`- ${row.label}`);
  }
  if (quote.scope?.trim()) {
    lines.push('');
    lines.push('Scope of work:');
    lines.push(quote.scope.trim());
  }
  if (!isPackageQuote(quote) || pkg) {
    lines.push('');
    const { beforeDiscount, discount, total } = quoteDiscountBreakdown(quote);
    if (discount < 0) {
      lines.push(`Was: ${money(beforeDiscount)}`);
      lines.push(`Discount: ${money(discount)}`);
    }
    lines.push(`Total quote: ${money(total)}`);
  }
  if (quote.assumptions?.trim()) {
    lines.push('');
    lines.push('Assumptions this quote is based on:');
    lines.push(quote.assumptions.trim());
  }
  lines.push('');
  lines.push('Payment terms:');
  lines.push(paymentTermsText(quote.paymentTerms));
  if (quote.termsText) {
    lines.push('');
    lines.push(quote.termsText);
  }
  lines.push('');
  lines.push(`${quote.fromName}${quote.fromPhone ? ' · ' + quote.fromPhone : ''}${quote.fromEmail ? ' · ' + quote.fromEmail : ''}`);
  return lines.join('\n');
}

// ─── Three-package quotes ───────────────────────────────────────────────────
// A package quote is inside+outside window cleaning only: the admin enters one
// Complete price (before discounts) and the other two are derived from it.
// Maths is in integer cents, rounding half up, so 0.75/1.75 never drift.

export type QuoteType = 'single' | 'packages';
export type PackageKey = 'essential' | 'complete' | 'premium';
export const PACKAGE_KEYS: PackageKey[] = ['essential', 'complete', 'premium'];

export interface PackagePricesCents { essential: number; complete: number; premium: number; }

// (num / den) cents rounded half up to a multiple of `step` cents. Prices are
// never negative, so floor of the shifted value is a true half-up.
function roundHalfUpCents(num: number, den: number, step: number): number {
  return Math.floor((num * 2 + den * step) / (den * step * 2)) * step;
}

export function packagePricesFromComplete(completeCents: number): PackagePricesCents {
  const c = Math.max(0, Math.round(completeCents));
  return {
    essential: roundHalfUpCents(c * 3, 4, 100),   // × 0.75, nearest $1
    complete: c,
    premium: roundHalfUpCents(c * 7, 4, 5000),    // × 1.75, nearest $50
  };
}

export const toCents = (dollars: number) => Math.round((Number(dollars) || 0) * 100);
export const fromCents = (cents: number) => cents / 100;

export const PACKAGE_INFO: Record<PackageKey, { name: string; description: string }> = {
  essential: { name: 'Essential', description: 'A thorough, streak-free clean of your glass, inside and out.' },
  complete: { name: 'Complete', description: 'Glass plus frames, seals and a light track clean, for a properly finished look.' },
  premium: { name: 'Premium Detail', description: 'Everything in Complete, plus deep tracks, flyscreens and light hard-water stain removal.' },
};

// Same 8 rows, same order, on every package card and on the formal quote.
export const PACKAGE_INCLUSIONS: { label: string; in: PackageKey[] }[] = [
  { label: 'Window cleaning (inside & outside)', in: ['essential', 'complete', 'premium'] },
  { label: 'Microfibre edge detailing', in: ['essential', 'complete', 'premium'] },
  { label: 'Frame cleaning', in: ['complete', 'premium'] },
  { label: 'Window seals', in: ['complete', 'premium'] },
  { label: 'Light track cleaning', in: ['complete', 'premium'] },
  { label: 'Deep track cleaning', in: ['premium'] },
  { label: 'Flyscreen cleaning', in: ['premium'] },
  { label: 'Light hard-water stain removal', in: ['premium'] },
];

export const PACKAGE_HARD_WATER_TERMS =
  'Hard-water stain removal only covers agreed deposits that can be safely treated. Heavy deposits or glass restoration are not included unless quoted separately, and full removal is not guaranteed.';

export function isPackageKey(v: unknown): v is PackageKey {
  return v === 'essential' || v === 'complete' || v === 'premium';
}

// Three-package only fits a plain inside+outside window clean. Returns why
// not (for the admin to read) or null when it's fine. Negative Other lines
// are discounts and are allowed; anything else separately priced isn't.
export function packageIneligibleReason(q: Pick<Quote, 'services' | 'extras' | 'otherLines'>): string | null {
  const others = q.services.filter(s => s !== WINDOW_OUTSIDE_KEY && s !== WINDOW_INSIDE_KEY);
  if (others.length || q.extras.length) {
    const names = [...others, ...q.extras].map(k => serviceLabel(k).replace(/ \(.*\)$/, '')).join(', ');
    return `Three-Package only works for inside & outside window cleaning. ${names} ${others.length + q.extras.length > 1 ? 'are' : 'is'} priced separately, so use Single Quote for this one.`;
  }
  if (!q.services.includes(WINDOW_OUTSIDE_KEY) || !q.services.includes(WINDOW_INSIDE_KEY)) {
    return 'Three-Package needs both Window Cleaning - Outside and Inside ticked. For outside-only, use Single Quote.';
  }
  if ((q.otherLines ?? []).some(l => (Number(l.amount) || 0) > 0)) {
    return 'Three-Package only allows discount lines (negative amounts) under Other. Anything extra that costs money needs a Single Quote.';
  }
  return null;
}

export function isPackageQuote(q: Pick<Quote, 'quoteType'>): boolean {
  return q.quoteType === 'packages';
}

export const discountLines = (q: Pick<Quote, 'otherLines'>) => (q.otherLines ?? []).filter(l => (Number(l.amount) || 0) < 0);

// A package quote seen as one ordinary quote for `pkg`: the package price is
// a single line, followed by the discount lines, so quoteTotal(),
// quoteDiscountBreakdown(), QuotePreview and buildQuoteText all work on it
// unchanged. Prices come only from the stored packagePrices.
export function quoteForPackage<T extends Pick<Quote, 'services' | 'extras' | 'itemAmounts' | 'otherLines' | 'amount' | 'packagePrices' | 'selectedPackage'>>(q: T, pkg: PackageKey): T {
  const priceCents = q.packagePrices?.[pkg] ?? 0;
  const lines: QuoteOtherLine[] = [
    { id: `pkg-${pkg}`, description: `${PACKAGE_INFO[pkg].name} package · window cleaning (inside & outside)`, amount: fromCents(priceCents) },
    ...discountLines(q),
  ];
  const view = { ...q, services: [], extras: [], itemAmounts: {}, otherLines: lines, selectedPackage: pkg };
  return { ...view, amount: quoteTotal(view) };
}

// Server-side: turn whatever the admin sent into the stored package fields.
// Only packagePrices.complete (cents) is read from the request; the other two
// are derived here.
// Returns an error string when the quote can't be a package quote.
export function resolvePackageFields(
  body: { quoteType?: unknown; packagePrices?: unknown },
  q: Pick<Quote, 'services' | 'extras' | 'otherLines' | 'termsText'>,
): { error: string } | { quoteType: QuoteType; packagePrices: PackagePricesCents | null; amount: number | null; termsText: string } {
  if (body.quoteType !== 'packages') return { quoteType: 'single', packagePrices: null, amount: null, termsText: q.termsText };
  const reason = packageIneligibleReason(q);
  if (reason) return { error: reason };
  const raw = body.packagePrices && typeof body.packagePrices === 'object' ? Number((body.packagePrices as Record<string, unknown>).complete) : NaN;
  if (!Number.isFinite(raw) || raw <= 0) return { error: 'Enter the Complete price (before discounts)' };
  const packagePrices = packagePricesFromComplete(raw);
  const termsText = q.termsText.includes(PACKAGE_HARD_WATER_TERMS) ? q.termsText : `${q.termsText.trim()} ${PACKAGE_HARD_WATER_TERMS}`.trim();
  return { quoteType: 'packages', packagePrices, amount: packageTotal({ otherLines: q.otherLines, packagePrices }, 'complete'), termsText };
}

// Customer-facing total for one package, in dollars (price + discounts).
export function packageTotal(q: Pick<Quote, 'otherLines' | 'packagePrices'>, pkg: PackageKey): number {
  return fromCents(q.packagePrices?.[pkg] ?? 0) + discountLines(q).reduce((s, l) => s + (Number(l.amount) || 0), 0);
}
// invoice.ts directly for these — keeps the quote surface self-contained.
export {
  money, addDays, longDate, GST_NOTE,
  type PaymentDueTerms, PAYMENT_DUE_TERMS_OPTIONS, DEFAULT_PAYMENT_DUE_TERMS, isPaymentDueTerms, paymentTermsText,
};
