// Invoice types, business defaults and pure helpers.
// No `fs` / `neon` imports here so this module is safe to import from client
// components (the editor + preview) as well as server code (db + public page).

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled';

// How a paid invoice was actually settled. `null` = not paid yet, or paid
// before this field existed. Bank transfer is the default payment path;
// the others cover being paid face-to-face on the job.
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'other';

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash (in person)',
  card: 'Card (in person)',
  other: 'Other',
};

export interface InvoiceLineItem {
  description: string;   // e.g. "Window Cleaning"
  detail: string;        // longer note shown under the description
  serviceAddress: string; // optional per-line service address
  date: string;          // YYYY-MM-DD service date for this line (optional)
  amount: number;        // line total in AUD
}

// Optional government / DVA-style client block. Hidden for normal customers.
export interface InvoiceClient {
  show: boolean;
  clientName: string;
  trn: string;
  fileNo: string;
  claimRef: string;
}

export interface Invoice {
  id: string;              // INV-timestamp
  number: string;          // e.g. GB1044
  seq: number;             // 1044 (numeric, for tracking / next-number)
  isTaxInvoice: boolean;   // false → titled "Invoice" (compliant default); true → "Tax Invoice"
  status: InvoiceStatus;
  paymentMethod: PaymentMethod | null;  // how it was paid, set when status → paid

  // FROM (business) — editable per invoice, pre-filled from BUSINESS_DEFAULTS
  fromName: string;
  fromTradingAs: string;
  fromAbn: string;
  fromAddress: string;
  fromEmail: string;
  fromPhone: string;

  // BILL TO
  billToName: string;
  billToLines: string;     // multiline free text (program / portal / attn)

  // Optional client block (DVA etc.)
  client: InvoiceClient;

  // Dates (YYYY-MM-DD)
  invoiceDate: string;
  serviceDate: string;
  dueDate: string;

  items: InvoiceLineItem[];
  subtotal: number;
  total: number;
  notes: string;           // footer note to the customer

  // PAYMENT — EFT bank transfer (default) or Square card checkout
  payAccountName: string;
  payBsb: string;
  payAccountNumber: string;

  // Square Online Checkout (card payment link). `squarePaidAt` is a CLAIM from
  // Square's webhook only — same spirit as a customer's "I've paid" tap: it
  // means Square says the card charge went through, not that the money has
  // been confirmed in the account. The real `paid`/`paymentMethod` flip is
  // still a manual admin action once that's verified.
  squarePaymentLinkUrl: string | null;
  squareOrderId: string | null;        // Square's order id — how the webhook finds this invoice
  squarePaymentId: string | null;      // Square's payment id, once completed
  squareLinkAmount: number | null;     // total (incl. surcharge) the link was generated for — regenerate if it drifts
  squarePaidAt: string | null;

  token: string;           // unguessable public-link token
  bookingId: string | null; // legacy: first linked booking (kept for back-compat)
  bookingIds: string[];     // all bookings linked to this invoice (address-matched or manual)
  ownerGuestId: string | null; // guest who created it (null = admin-owned)
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  paidAt: string | null;

  // Customer-view tracking (admin previews are excluded — see recordInvoiceView)
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
}

// Everything the create endpoint accepts; the store fills in the rest
// (id, number, seq, token, totals, timestamps).
export type InvoiceInput = Omit<
  Invoice,
  'id' | 'number' | 'seq' | 'token' | 'subtotal' | 'total' | 'createdAt' | 'updatedAt' | 'sentAt' | 'paidAt' | 'status' | 'paymentMethod'
  | 'viewCount' | 'firstViewedAt' | 'lastViewedAt'
  | 'squarePaymentLinkUrl' | 'squareOrderId' | 'squarePaymentId' | 'squareLinkAmount' | 'squarePaidAt'
> & {
  status?: InvoiceStatus;
  paymentMethod?: PaymentMethod | null;
};

// ownerGuestId is part of InvoiceInput (via the Omit above it stays), set by the
// create endpoint based on who is logged in.

// ─── Business + payment defaults (from the Glass and Blast DVA invoice) ───────
// Editable per invoice in the form; these are just the pre-filled starting values.
export const BUSINESS_DEFAULTS = {
  fromName: 'Lincoln Uren',
  fromTradingAs: 'Glass and Blast',
  fromAbn: '17 169 059 505',
  fromAddress: '3/14 Portus Place, Bruce ACT 2617',
  fromEmail: 'lincolnblu@icloud.com',
  fromPhone: '0466 050 834',
};

export const PAYMENT_DEFAULTS = {
  payAccountName: 'Lincoln Uren',
  payBsb: '062-913',
  payAccountNumber: '11315803',
};

// ─── Saved payment profiles (selectable presets in the invoice editor) ────────
export interface PaymentProfile {
  id: string;
  name: string;          // label shown in the selector, e.g. "Lincoln"
  accountName: string;
  bsb: string;
  accountNumber: string;
  sort: number;
  builtin: boolean;      // built-ins can't be deleted from the UI
}

// Seeded into the DB (and the local JSON store) on first run.
export const SEED_PAYMENT_PROFILES: PaymentProfile[] = [
  { id: 'lincoln', name: 'Lincoln', accountName: 'Lincoln Uren', bsb: '062-913', accountNumber: '11315803', sort: 0, builtin: true },
  { id: 'liam',    name: 'Liam',    accountName: 'Liam Ward',    bsb: '062-904', accountNumber: '1061 9656',  sort: 1, builtin: true },
];

export const INVOICE_PREFIX = 'GB';
// Next number after the DVA invoice GB1043. The counter is seeded to 1043 so the
// first generated invoice is GB1044.
export const INVOICE_START_SEQ = 1044;

// Not registered for GST → this line replaces any GST/tax wording. Kept in one
// place so the compliance note is consistent everywhere it renders.
export const GST_NOTE = 'No GST has been charged. Supplier is not registered for GST.';

// Card surcharge passed on to the customer when paying via the Square link —
// covers Square's own transaction fee. NEXT_PUBLIC_ so both the server (when
// creating the Square payment link) and the client preview/public page (when
// just *displaying* the card total) compute the identical figure. Check this
// against your actual contracted Square rate (Square dashboard → Fees) and
// adjust the env var — don't assume 1.9% is exactly right for your account.
export const SQUARE_SURCHARGE_PERCENT = Number(process.env.NEXT_PUBLIC_SQUARE_SURCHARGE_PERCENT || '1.9');

// Invoice total plus the card surcharge, rounded to cents.
export function cardTotal(total: number): number {
  return Math.round(total * (1 + SQUARE_SURCHARGE_PERCENT / 100) * 100) / 100;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function money(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function computeTotals(items: InvoiceLineItem[]): { subtotal: number; total: number } {
  const subtotal = (items || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  return { subtotal, total: subtotal }; // no GST → total === subtotal
}

// Add days to a YYYY-MM-DD date, returning YYYY-MM-DD.
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1);
  base.setDate(base.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

// "26 June 2026" from an ISO/YYYY-MM-DD date; '' passes through.
export function longDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// "24/06/2026" short form for line-item dates.
export function shortDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function emptyLineItem(): InvoiceLineItem {
  return { description: '', detail: '', serviceAddress: '', date: '', amount: 0 };
}

// A blank invoice pre-filled with business + payment defaults, for the "New
// invoice" form. `todayStr` lets the caller pass the local date.
export function blankInvoiceInput(todayStr: string): InvoiceInput {
  return {
    isTaxInvoice: false,
    ...BUSINESS_DEFAULTS,
    billToName: '',
    billToLines: '',
    client: { show: false, clientName: '', trn: '', fileNo: '', claimRef: '' },
    invoiceDate: todayStr,
    serviceDate: todayStr,
    dueDate: addDays(todayStr, 30),
    items: [emptyLineItem()],
    notes: 'Thank you for your business.',
    ...PAYMENT_DEFAULTS,
    bookingId: null,
    bookingIds: [],
    ownerGuestId: null,
  };
}

// ─── Booking ↔ invoice address matching (pure, client + server safe) ──────────
// Normalise a street address for comparison: lowercase, strip punctuation,
// collapse whitespace, drop a trailing state/postcode tail so "12 Foo St,
// Ainslie ACT 2602" and "12 foo street ainslie" still match.
export function normalizeAddress(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .replace(/\b(act|nsw|australia)\b/g, ' ')
    .replace(/\b\d{4}\b/g, ' ')       // postcode
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\broad\b/g, 'rd')
    .replace(/\bcrescent\b/g, 'cres').replace(/\bplace\b/g, 'pl').replace(/\bdrive\b/g, 'dr')
    .replace(/\s+/g, ' ')
    .trim();
}

// True when two addresses look like the same place (one contains the other after
// normalising — handles "12 Foo St" vs "12 Foo St, Ainslie").
export function addressesMatch(a: string, b: string): boolean {
  const x = normalizeAddress(a), y = normalizeAddress(b);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  return x === y || x.includes(y) || y.includes(x);
}
