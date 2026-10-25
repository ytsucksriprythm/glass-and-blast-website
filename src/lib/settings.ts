// App-wide, runtime-editable business settings — one singleton object, stored
// as a JSON blob (Neon `app_settings` table / data/settings.json locally, see
// db.ts). Unlike .env vars, these can be changed from /admin/settings without
// a redeploy. Secrets (API keys, admin password) deliberately stay in env —
// only non-secret behavior/toggles live here.

export interface AppSettings {
  // Square card payments (see src/lib/square.ts). Requires SQUARE_ACCESS_TOKEN
  // + SQUARE_LOCATION_ID to also be set in env — this toggle can turn the
  // feature off any time, but can't turn it on without those secrets present.
  // Turning it on makes the customer-facing Pay-by-card button, the admin
  // link-generation UI, and the webhook all live at once.
  squareCardPaymentsEnabled: boolean;
  squareSurchargePercent: number;

  // Notifications — new bookings only (website form or Facebook lead), as an
  // ntfy push + owner email. See src/lib/notifications.ts.
  notificationsEnabled: boolean;       // master switch
  notifyNewBooking: boolean;           // new booking

  // Customer review / feedback flow (src/app/thanks/[token])
  googleReviewUrl: string;
  reviewStarThreshold: number; // stars >= this go straight to the Google review link; below opens the private feedback box
  customerFeedbackEnabled: boolean; // show the star-rating widget on the thank-you page at all

  // Scheduling
  defaultJobStartTime: string; // "HH:MM", used when recurring plans auto-book a visit
  recurringAutoBookEnabled: boolean; // pause the daily recurring-plan cron without deleting plans

  // Recurring customer contract (customer portal, src/lib/contract.ts). Each
  // signed contract snapshots these, so changing them only affects contracts
  // signed afterwards.
  contractTermMonths: number;              // length of each term; auto-renews for the same length
  contractCancelFeePercent: number;        // % of the remaining visits' value owed on early cancellation
  contractFeeFirstTermOnly: boolean;       // after the first term they can cancel any time, no fee
  contractCoolingOffDays: number;          // business days after signing to cancel with no fee (0 = none)
  contractExtraTerms: string;              // extra clause text added to every contract (blank = none)

  // Public site
  acceptingNewBookings: boolean; // false shows a "not currently accepting bookings" message instead of the form
  siteTrackingEnabled: boolean;  // page-view tracking (src/components/PageTracker.tsx)

  // Invoice autofill (src/lib/invoice.ts BusinessProfile/PaymentProfile, managed
  // in Settings -> Invoice autofill). With the toggle off, a new invoice starts
  // blank for that section instead of pre-filling from the first profile.
  autofillBusinessInfo: boolean;
  autofillPaymentDetails: boolean;

  // Default for whether a new NORMAL invoice shows the business address.
  // Tax invoices always show it, regardless of this setting.
  defaultShowAddressOnInvoice: boolean;
  // Same idea for quotes — no tax-invoice-style forced override, since a
  // quote is never a tax invoice.
  defaultShowAddressOnQuote: boolean;

  // Three-package quotes (src/lib/quote.ts): Essential and Premium Detail as a
  // whole-number % of the Complete price. Each quote stores its own prices
  // when saved, so changing these never changes quotes already made.
  packageEssentialPercent: number;  // Essential, rounded to the nearest $1
  packagePremiumPercent: number;    // Premium Detail, rounded to the nearest $50

  // LARP mode (src/lib/larp.ts) — a joke "make us look busy and rich" button.
  // Fills the CRM with fake, clearly-tagged bookings; turning it off deletes
  // exactly those rows and nothing else. larpRevenueTarget is the slider
  // position ($10k-$1M) that controls roughly how much fake paid revenue
  // gets generated.
  larpModeActive: boolean;
  larpRevenueTarget: number;
  // Which categories of fake data the next "Larp" press generates. Each is
  // independently toggleable in Settings; "Full Larper" there is a derived
  // convenience that's on only when every one of these is on.
  larpFakeNumbers: boolean;     // fake site-traffic (page views) for Site Stats
  larpFakeBookings: boolean;    // the fake bookings themselves — master for the rest below
  larpFakeColdLeads: boolean;   // some fake bookings land in Cold Lead status
  larpFakeInvoices: boolean;    // an invoice generated per fake booking
  larpFakeCalendar: boolean;    // fake bookings get a scheduledAt slot (fills the calendar)
}

export const DEFAULT_SETTINGS: AppSettings = {
  squareCardPaymentsEnabled: false,
  squareSurchargePercent: Number(process.env.NEXT_PUBLIC_SQUARE_SURCHARGE_PERCENT || '1.9'),

  notificationsEnabled: true,
  notifyNewBooking: true,

  googleReviewUrl: 'https://g.page/r/CTZqwIjUWFvcEBM/review',
  reviewStarThreshold: 4,
  customerFeedbackEnabled: true,

  defaultJobStartTime: '09:00',
  recurringAutoBookEnabled: true,

  contractTermMonths: 12,
  contractCancelFeePercent: 10,
  contractFeeFirstTermOnly: true,
  contractCoolingOffDays: 10,
  contractExtraTerms: '',

  acceptingNewBookings: true,
  siteTrackingEnabled: true,

  autofillBusinessInfo: true,
  autofillPaymentDetails: true,

  defaultShowAddressOnInvoice: true,
  defaultShowAddressOnQuote: false,

  packageEssentialPercent: 75,
  packagePremiumPercent: 175,

  larpModeActive: false,
  larpRevenueTarget: 250000,
  larpFakeNumbers: true,
  larpFakeBookings: true,
  larpFakeColdLeads: true,
  larpFakeInvoices: true,
  larpFakeCalendar: true,
};
