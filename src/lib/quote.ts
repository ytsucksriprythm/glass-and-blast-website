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

export const QUOTE_SERVICE_OPTIONS = [
  { key: 'window-washing', label: 'Window Cleaning' },
  { key: 'pressure-washing', label: 'Pressure Washing' },
  { key: 'solar-panel-cleaning', label: 'Solar Panel Cleaning' },
] as const;

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
}

// Everything the create endpoint accepts; the store fills in the rest
// (id, number, seq, token, timestamps).
export type QuoteInput = Omit<Quote, 'id' | 'number' | 'seq' | 'token' | 'createdAt' | 'updatedAt' | 'sentAt' | 'status'> & {
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
>): string {
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
    ...quote.services.map((k): [string, number] => [serviceLabel(k), Number(quote.itemAmounts?.[k]) || 0]),
    ...quote.extras.map((k): [string, number] => [serviceLabel(k), Number(quote.itemAmounts?.[k]) || 0]),
    ...(quote.otherLines ?? [])
      .filter(l => l.description.trim() || l.amount)
      .map((l): [string, number] => [l.description.trim() || 'Other', Number(l.amount) || 0]),
  ];
  if (items.length) {
    lines.push('');
    lines.push('Services:');
    for (const [label, amt] of items) lines.push(`- ${label}: ${money(amt)}`);
  }
  if (quote.scope?.trim()) {
    lines.push('');
    lines.push('Scope of work:');
    lines.push(quote.scope.trim());
  }
  lines.push('');
  lines.push(`Total quote: ${money(quoteTotal(quote))}`);
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

// Re-exported so callers building quote UI don't also need to import from
// invoice.ts directly for these — keeps the quote surface self-contained.
export {
  money, addDays, longDate, GST_NOTE,
  type PaymentDueTerms, PAYMENT_DUE_TERMS_OPTIONS, DEFAULT_PAYMENT_DUE_TERMS, isPaymentDueTerms, paymentTermsText,
};
