import { addDays, invoiceDaysOverdue, type Invoice } from './invoice';
import type { Booking } from './db';
import type { Quote } from './quote';
import { daysBetween, sydneyLocalToIso, toSydney } from './mcp/time';

export const DAY = 86_400_000;

export function invoiceReminderOnHold(invoice: Invoice, links: Booking[]) {
  return invoice.reminderHold || links.some(job => job.customerMarkedPaidAt) ||
    /\b(disput(?:e|ed)|reminder hold|payment hold)\b/i.test([invoice.notes, ...links.map(job => job.adminNotes)].join('\n'));
}

export function invoiceMilestone(invoice: Invoice, links: Booking[], days = invoiceDaysOverdue(invoice)) {
  if (invoice.status !== 'sent' || invoice.squarePaidAt || invoice.paidAt || invoice.total <= 0 ||
      !links.length || links.every(job => job.paid) || invoiceReminderOnHold(invoice, links)) return 0;
  return [30, 14, 7].find(threshold => days >= threshold) ?? 0;
}

export function quoteEligible(quote: Quote, job: Booking, today: string) {
  const sentDate = toSydney(quote.sentAt)?.date;
  const age = sentDate ? daysBetween(sentDate, today) : -1;
  return quote.status === 'sent' && !quote.acceptedAt && !quote.selectedPackage &&
    age >= 5 && age <= 10 && (!quote.validUntil || quote.validUntil >= today) &&
    ['uncontacted', 'contacted', 'quoted'].includes(job.status) && !job.scheduledAt && !job.paid &&
    !/\b(declined|do not contact)\b/i.test(job.adminNotes ?? '');
}

export function hasMarketingConsent(job: Booking) {
  return /^SMS marketing consent:\s*\S.+$/im.test(job.adminNotes ?? '') &&
    !/\b(marketing consent withdrawn|do not contact|do not text)\b/i.test(job.adminNotes ?? '');
}

export function overlapsBooking(bookings: Booking[], id: string, start: string, end: string) {
  return bookings.some(job => {
    if (job.id === id || job.deletedAt || job.status === 'cancelled' || !job.scheduledAt) return false;
    const from = Date.parse(job.scheduledAt);
    const until = job.scheduledEnd ? Date.parse(job.scheduledEnd) : from + 120 * 60_000;
    return from < Date.parse(end) && Date.parse(start) < until;
  });
}

const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export type SmsIntent = { intent: 'reschedule' | 'cancel' | 'other'; localStart?: string };

export function interpretSms(text: string, receivedAt: string): SmsIntent {
  const lower = text.toLowerCase();
  if (/\b(cancel|call off)\b/.test(lower)) return { intent: 'cancel' };
  if (!/\b(reschedul\w*|rebook\w*|move|change|postpone|instead)\b/.test(lower)) return { intent: 'other' };
  const pending: SmsIntent = { intent: 'reschedule' };
  const reference = toSydney(receivedAt)?.date;
  if (!reference || /\b(or|next|unless|after|before|around|between|maybe|only|if|not|either|cannot|can?t|can't|won?t|won't)\b/.test(lower) || /\d{1,2}[/\.]\d{1,2}/.test(lower)) return pending;
  const dates = [...lower.matchAll(/\b(\d{4}-\d{2}-\d{2}|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)];
  const times = [...lower.matchAll(/\b(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm)|(\d{2}):(\d{2}))\b/g)];
  if (dates.length !== 1 || times.length !== 1) return pending;
  if (!/\b(to|for)\b/.test(lower.slice(0, dates[0].index))) return pending;
  const word = dates[0][1];
  let day = word;
  if (word === 'tomorrow') day = addDays(reference, 1);
  const weekday = weekdays.indexOf(word);
  if (weekday >= 0) {
    const current = new Date(reference + 'T00:00:00Z').getUTCDay();
    day = addDays(reference, (weekday - current + 7) % 7 || 7);
  }
  const [, hour12, minutes12, meridiem, hour24, minutes24] = times[0];
  if (hour12 && (+hour12 < 1 || +hour12 > 12)) return pending;
  const hour = hour24 ?? String(+hour12 % 12 + (meridiem === 'pm' ? 12 : 0));
  const localStart = day + 'T' + hour.padStart(2, '0') + ':' + (minutes24 ?? minutes12 ?? '00');
  return sydneyLocalToIso(localStart) ? { intent: 'reschedule', localStart } : pending;
}
