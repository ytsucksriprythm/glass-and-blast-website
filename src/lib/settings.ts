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
  customerFeedbackEnabled: boolean; // show the star-rating widget on the thank-you page at all

  // Scheduling
  defaultJobStartTime: string; // "HH:MM", used when recurring plans auto-book a visit
  recurringAutoBookEnabled: boolean; // pause the daily recurring-plan cron without deleting plans

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
}

export const DEFAULT_SETTINGS: AppSettings = {
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
  customerFeedbackEnabled: true,

  defaultJobStartTime: '09:00',
  recurringAutoBookEnabled: true,

  acceptingNewBookings: true,
  siteTrackingEnabled: true,

  autofillBusinessInfo: true,
  autofillPaymentDetails: true,

  defaultShowAddressOnInvoice: true,
};
