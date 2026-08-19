// Quote types and pure helpers. No `fs`/`neon` imports here so this module is
// safe to import from client components (the modal + preview) as well as
// server code (db + the public page) — same rule as invoice.ts.
//
// A Quote is deliberately simpler than an Invoice: one lump-sum `amount`
// (no itemized line items), admin-only (no guest ownership, no Square/payment
// block), and no view tracking (not requested — see TRANSFER.md).

import { money, addDays, longDate, GST_NOTE } from './invoice';

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

export function serviceLabel(key: string): string {
  return QUOTE_SERVICE_OPTIONS.find(o => o.key === key)?.label
    ?? QUOTE_EXTRA_OPTIONS.find(o => o.key === key)?.label
    ?? key;
}

export interface Quote {
  id: string;              // QT-<timestamp>
  number: string;          // Q1000, Q1001, ... sequential (atomic counter, mirrors invoice numbering)
  seq: number;
  token: string;            // unguessable public-link token, qt_<24 hex>
  bookingId: string;        // a quote is for exactly one job (unlike invoices' bookingIds[])
  status: QuoteStatus;      // 'draft' on create; flips to 'sent' as a side effect of Copy/Share

  services: string[];       // subset of QUOTE_SERVICE_OPTIONS keys
  extras: string[];         // subset of QUOTE_EXTRA_OPTIONS keys
  otherText: string;        // free-text "other" line
  amount: number;           // single lump-sum price — NOT itemized

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
  'This is a quote, not a tax invoice. No GST has been charged, as we are not registered for GST. ' +
  `This price is valid for ${QUOTE_VALID_DAYS} days from the quote date above — after that, please ask us to reissue it. ` +
  "The final price may change if the property's condition or access differs from what was described or observed at the time of quoting. " +
  'We will always confirm any change with you before the job starts.';

export function emptyQuoteDraft(fromDefaults: { fromName: string; fromTradingAs: string; fromAbn: string; fromAddress: string; fromEmail: string; fromPhone: string }, todayStr: string): QuoteInput {
  return {
    bookingId: '',
    services: [],
    extras: [],
    otherText: '',
    amount: 0,
    propertyType: 'residential',
    billToName: '',
    billToAddress: '',
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
  'number' | 'fromTradingAs' | 'fromName' | 'fromPhone' | 'fromEmail' | 'billToName' | 'billToAddress' |
  'quoteDate' | 'validUntil' | 'services' | 'extras' | 'otherText' | 'amount' | 'termsText'
>): string {
  const lines: string[] = [];
  lines.push(`QUOTE ${quote.number} — ${quote.fromTradingAs || 'Glass and Blast'}`);
  lines.push('');
  if (quote.quoteDate) lines.push(`Date: ${longDate(quote.quoteDate)}`);
  if (quote.validUntil) lines.push(`Valid until: ${longDate(quote.validUntil)}`);
  if (quote.billToName || quote.billToAddress) {
    lines.push('');
    lines.push('Prepared for:');
    if (quote.billToName) lines.push(quote.billToName);
    if (quote.billToAddress) lines.push(quote.billToAddress);
  }
  const items = [
    ...quote.services.map(serviceLabel),
    ...quote.extras.map(serviceLabel),
    ...(quote.otherText.trim() ? [quote.otherText.trim()] : []),
  ];
  if (items.length) {
    lines.push('');
    lines.push('Services:');
    for (const it of items) lines.push(`- ${it}`);
  }
  lines.push('');
  lines.push(`Total quote: ${money(quote.amount)}`);
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
export { money, addDays, longDate, GST_NOTE };
