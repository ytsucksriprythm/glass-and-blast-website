import type { Booking } from './db';
import type { Quote } from './quote';
import { paymentDueTermsDays } from './invoice';
import type { InvoicePrefill } from '@/components/InvoiceEditor';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Cleaning',
  'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure Washing',
  'other': 'Cleaning Service',
};
const serviceText = (s: string) =>
  (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || 'Cleaning Service';

// dueDays comes from the booking's most recent Quote (if any) — carries the
// payment terms the customer already agreed to on the quote over to the
// invoice, instead of falling back to the generic default.
export function bookingToInvoicePrefill(b: Booking, quotes: Quote[]): InvoicePrefill {
  const address = [b.address, b.suburb].filter(Boolean).join(', ');
  const latestQuote = quotes[0]; // getQuotesForBooking returns newest-first (by seq)
  return {
    billToName: b.name,
    billToLines: address,
    itemDescription: serviceText(b.service),
    itemServiceAddress: address,
    amount: typeof b.quoteAmount === 'number' ? b.quoteAmount : null,
    serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(b.preferredDate) ? b.preferredDate : '',
    bookingId: b.id,
    dueDays: latestQuote ? paymentDueTermsDays(latestQuote.paymentTerms) : undefined,
  };
}
