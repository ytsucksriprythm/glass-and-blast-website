// App-wide, runtime-editable business settings — one singleton object, stored
// as a JSON blob (Neon `app_settings` table / data/settings.json locally, see
// db.ts). Unlike .env vars, these can be changed from /admin/settings without
// a redeploy. Secrets (API keys, admin password) deliberately stay in env —
// only non-secret behavior/business config lives here.
import { BUSINESS_DEFAULTS, PAYMENT_DEFAULTS, GST_NOTE } from './invoice';

export interface AppSettings {
  // Business info — pre-fills new invoices (and nothing else; already-created
  // invoices keep their own saved copy of these fields).
  businessName: string;
  tradingAs: string;
  abn: string;
  address: string;
  email: string;
  phone: string;

  // Payment defaults — pre-fills new invoices' bank details (the payment
  // profile picker in the invoice editor can still override per-invoice).
  payAccountName: string;
  payBsb: string;
  payAccountNumber: string;

  // Invoice behavior
  defaultPaymentTermsDays: number; // due date = invoice date + this many days
  defaultInvoiceNotes: string;     // footer note pre-filled on new invoices
  gstNoteText: string;             // compliance disclaimer wording only — does NOT calculate GST

  // Square card payments (see src/lib/square.ts). Requires SQUARE_ACCESS_TOKEN
  // + SQUARE_LOCATION_ID to also be set in env — this toggle can turn the
  // feature off any time, but can't turn it on without those secrets present.
  squareCardPaymentsEnabled: boolean;
  squareSurchargePercent: number;

  // Notifications (ntfy pushes — see src/lib/notify.ts + notifications.ts)
  notificationsEnabled: boolean;       // master switch
  notifyStatusChange: boolean;         // job status changed
  notifyJobAssigned: boolean;          // job sent to a subcontractor
  notifyCustomerMarkedPaid: boolean;   // customer tapped "I've paid"
  notifySquarePaid: boolean;           // Square webhook confirms a card payment
  notifyNewBooking: boolean;           // new booking from the public site

  // Customer review / feedback flow (src/app/thanks/[token])
  googleReviewUrl: string;
  reviewStarThreshold: number; // stars >= this go straight to the Google review link; below opens the private feedback box

  // Scheduling
  defaultJobStartTime: string; // "HH:MM", used when recurring plans auto-book a visit
}

export const DEFAULT_SETTINGS: AppSettings = {
  businessName: BUSINESS_DEFAULTS.fromName,
  tradingAs: BUSINESS_DEFAULTS.fromTradingAs,
  abn: BUSINESS_DEFAULTS.fromAbn,
  address: BUSINESS_DEFAULTS.fromAddress,
  email: BUSINESS_DEFAULTS.fromEmail,
  phone: BUSINESS_DEFAULTS.fromPhone,

  payAccountName: PAYMENT_DEFAULTS.payAccountName,
  payBsb: PAYMENT_DEFAULTS.payBsb,
  payAccountNumber: PAYMENT_DEFAULTS.payAccountNumber,

  defaultPaymentTermsDays: 30,
  defaultInvoiceNotes: 'Thank you for your business.',
  gstNoteText: GST_NOTE,

  squareCardPaymentsEnabled: false,
  squareSurchargePercent: Number(process.env.NEXT_PUBLIC_SQUARE_SURCHARGE_PERCENT || '1.9'),

  notificationsEnabled: true,
  notifyStatusChange: true,
  notifyJobAssigned: true,
  notifyCustomerMarkedPaid: true,
  notifySquarePaid: true,
  notifyNewBooking: true,

  googleReviewUrl: 'https://g.page/r/CTZqwIjUWFvcEBM/review',
  reviewStarThreshold: 4,

  defaultJobStartTime: '09:00',
};
