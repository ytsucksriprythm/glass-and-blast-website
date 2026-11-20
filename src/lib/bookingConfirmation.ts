import type { Booking } from './db';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing',
  'pressure-washing': 'Pressure Washing',
  'both': 'Both Services',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'other': 'Other',
};
export const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';

export function buildConfirmationText(b: Booking): string {
  const d = new Date(b.scheduledAt as string);
  const date = d.toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).toUpperCase();
  const address = [b.address, b.suburb].filter(Boolean).join(', ');
  const rule = '━━━━━━━━━━━━━━━━━━';
  const lines = [
    'GLASS & BLAST',
    'BOOKING CONFIRMATION',
    rule,
    `Ref: ${b.id.replace(/^BK-/, '').slice(-6)}`,
    b.name ? `Client: ${b.name}` : '',
    `Date: ${date}`,
    `Time: ${time}`,
    address ? `Address: ${address}` : '',
    `Service: ${serviceText(b.service)}${b.propertyType === 'commercial' ? ' (Commercial)' : ''}`,
    typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? `Price: $${b.quoteAmount.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '',
    b.paid ? 'Payment: Received' : '',
    rule,
    'Status: CONFIRMED',
    '0466 050 834 | glassandblast.com.au',
  ];
  return lines.filter(Boolean).join('\n');
}
