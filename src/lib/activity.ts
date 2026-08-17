// Types + pure helpers for the two logging systems:
//  - ActivityEntry: a site-wide feed of notable events (bookings, invoices,
//    settings, guests, groups, Square payments) shown at the bottom of
//    /admin/settings.
//  - InvoiceViewSession: one row per time someone opens a specific invoice's
//    public link — IP, device, approximate location, how long it stayed open.
//    Shown via the "View log" button on that invoice.
// No `fs`/network imports here so this stays safe to import from anywhere.

export interface ActivityEntry {
  id: string;
  type: string;
  summary: string;
  meta: Record<string, unknown> | null;
  actor: string;          // 'admin' | 'guest:<id>' | 'customer' | 'system'
  invoiceId: string | null;
  createdAt: string;
}

export interface InvoiceViewSession {
  id: string;
  invoiceId: string;
  ip: string;
  deviceType: string; // 'Mobile' | 'Tablet' | 'Desktop' | 'Unknown'
  browser: string;
  city: string | null;
  region: string | null;
  country: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
}

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  'booking.created': 'Booking created',
  'booking.deleted': 'Booking deleted',
  'booking.status_changed': 'Booking status changed',
  'booking.auto_moved_cold': 'Auto-moved to Cold Lead',
  'booking.contacted': 'Lead marked contacted',
  'invoice.created': 'Invoice created',
  'invoice.deleted': 'Invoice deleted',
  'invoice.status_changed': 'Invoice status changed',
  'invoice.customer_marked_paid': 'Customer tapped "I\'ve paid"',
  'invoice.pay_by_card_clicked': 'Pay-by-card button clicked',
  'square.paid': 'Square payment confirmed',
  'settings.updated': 'Settings changed',
  'guest.created': 'Guest login created',
  'guest.deleted': 'Guest login deleted',
  'group.created': 'Booking group created',
  'group.deleted': 'Booking group deleted',
  'larp.started': 'LARP mode turned on',
  'larp.stopped': 'LARP mode turned off',
  'media.uploaded': 'File uploaded to media library',
  'media.deleted': 'File deleted from media library',
};

// Lightweight User-Agent classification — no dependency needed for this.
export function classifyDevice(ua: string): string {
  if (!ua) return 'Unknown';
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'Tablet';
  if (/mobile|iphone|android/i.test(ua)) return 'Mobile';
  return 'Desktop';
}

export function classifyBrowser(ua: string): string {
  if (!ua) return 'Unknown';
  if (/edg\//i.test(ua)) return 'Edge';
  if (/(chrome|crios)\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
  if (/firefox|fxios/i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua) && !/(chrome|crios|android)/i.test(ua)) return 'Safari';
  return 'Other';
}
