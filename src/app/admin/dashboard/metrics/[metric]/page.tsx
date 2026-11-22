import { ArrowLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getActiveContext } from '@/lib/auth';
import { sydneyDay } from '@/lib/callingTypes';
import { getBookings, type Booking, type BookingStatus } from '@/lib/db';
import { money } from '@/lib/invoice';
import RevenueLineChart, { type RevenuePoint } from './RevenueLineChart';

const statuses = {
  uncontacted: 'Uncontacted',
  contacted: 'Contacted',
  'quote-booked': 'Quote Booked',
  quoted: 'Quoted',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  cold: 'Cold Lead',
} satisfies Record<BookingStatus, string>;

const titles = {
  ...statuses,
  leads: 'Total Leads',
  'quote-value': 'Quote Value',
  revenue: 'Total Revenue',
  'revenue-this-month': 'Revenue This Month',
  owed: 'Owed',
};

const dateLabel = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney',
});
const monthLabel = new Intl.DateTimeFormat('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function paymentDay(booking: Booking) {
  const date = booking.paidAt || booking.completedAt;
  return date && Number.isFinite(Date.parse(date)) ? sydneyDay(date) : '';
}

function RevenueChart({ bookings, daily }: { bookings: Booking[]; daily: boolean }) {
  const totals = new Map<string, number>();
  for (const booking of bookings) {
    const day = paymentDay(booking);
    if (!day) continue;
    const period = daily ? day : day.slice(0, 7);
    totals.set(period, (totals.get(period) ?? 0) + (booking.quoteAmount ?? 0));
  }
  const periods = [...totals.keys()].sort();
  if (periods.length === 0) return <p className="text-sm text-slate-400">No dated payments in this period.</p>;
  const first = daily ? periods[0].slice(0, 7) + '-01' : periods[0] + '-01';
  const latestPeriod = periods[periods.length - 1];
  const today = sydneyDay(Date.now());
  const currentMonth = today.slice(0, 7);
  const periodEnd = daily ? today : currentMonth;
  const lastPeriod = latestPeriod > periodEnd ? latestPeriod : periodEnd;
  const last = daily ? lastPeriod : lastPeriod + '-01';
  const points: RevenuePoint[] = [];
  for (const date = new Date(first); date.toISOString().slice(0, 10) <= last;) {
    const period = date.toISOString().slice(0, daily ? 10 : 7);
    points.push({ period, label: (daily ? dayLabel : monthLabel).format(date), amount: totals.get(period) ?? 0 });
    if (daily) date.setUTCDate(date.getUTCDate() + 1);
    else date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return <RevenueLineChart points={points} />;
}

export default async function DashboardMetricPage({ params }: { params: Promise<{ metric: string }> }) {
  const session = await getActiveContext();
  if (session?.role !== 'admin') redirect('/admin');
  const { metric } = await params;
  if (!Object.hasOwn(titles, metric)) notFound();
  const title = titles[metric as keyof typeof titles];
  const bookings = await getBookings();
  const daily = metric === 'revenue-this-month';
  const revenue = metric === 'revenue' || daily;
  const currentMonth = sydneyDay(Date.now()).slice(0, 7);
  const rows = bookings.filter(booking => {
    if (revenue) return booking.paid && typeof booking.quoteAmount === 'number' &&
      (!daily || paymentDay(booking).startsWith(currentMonth));
    if (metric === 'owed') return booking.status === 'completed' && !booking.paid;
    if (metric === 'quote-value') return (booking.quoteAmount ?? 0) > 0;
    return metric === 'leads' || booking.status === metric;
  });
  if (revenue) rows.sort((a, b) => paymentDay(b).localeCompare(paymentDay(a)));
  const showTotal = revenue || metric === 'owed' || metric === 'quote-value';
  const total = rows.reduce((sum, booking) => sum + (booking.quoteAmount ?? 0), 0);
  const undated = revenue ? rows.filter(booking => !paymentDay(booking)).length : 0;
  const listTitle = revenue ? 'Paid jobs' : metric === 'owed' ? 'Completed, unpaid jobs' : 'Bookings';

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 pb-12 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
      <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded text-sm font-medium text-sky-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Dashboard
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-white sm:text-3xl">{title}</h1>
        {showTotal && <p className="mt-2 text-3xl font-semibold tabular-nums text-white">{money(total)}</p>}
      </header>
      {revenue && (
        <section className="glass rounded-2xl border border-white/10 p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">{daily ? 'Revenue by day' : 'Revenue by month'}</h2>
          <RevenueChart bookings={rows} daily={daily} />
          {undated > 0 && <p className="mt-4 text-sm text-slate-400">{undated} paid {undated === 1 ? 'job has' : 'jobs have'} no recorded date and only appear in the total and job list.</p>}
        </section>
      )}
      <section aria-labelledby="metric-bookings">
        <h2 id="metric-bookings" className="mb-3 text-lg font-semibold">{listTitle} <span className="ml-1 text-sm font-normal text-slate-400">({rows.length})</span></h2>
        {rows.length === 0 ? <p className="text-sm text-slate-400">No matching bookings.</p> : (
          <ul className="glass divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/10">
            {rows.map(booking => {
              const paidOn = revenue ? paymentDay(booking) : '';
              return (
                <li key={booking.id}>
                  <Link href={`/admin/bookings/${booking.id}`} prefetch={false} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <div className="break-words font-medium text-white">{booking.name}</div>
                      <div className="break-words text-sm text-slate-400">{[booking.address, booking.suburb].filter(Boolean).join(', ')}</div>
                      <div className="text-xs text-slate-400">
                        {revenue ? (paidOn ? dateLabel.format(new Date(paidOn)) : 'Payment date unavailable') : statuses[booking.status]}
                      </div>
                    </div>
                    {typeof booking.quoteAmount === 'number' && <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{money(booking.quoteAmount)}</span>}
                    <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
