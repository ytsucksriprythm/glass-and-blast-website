// Client-safe helpers for recurring customer profiles (no db imports, so the
// admin pages can use them directly). The profile itself is a RecurringJob row
// in db.ts; every booking made for that customer carries its recurringId.
import type { RecurringJob, RecurringFrequency, IntervalUnit } from '@/lib/db';

// The plan tiers offered on the website (see PLANS in src/app/page.tsx) — keep
// the discounts in step with what customers were promised there. Discount is
// $ off each clean, on jobs over PLAN_DISCOUNT_MIN.
export const PLAN_PRESETS: { frequency: RecurringFrequency; label: string; cadence: string; discount: number }[] = [
  { frequency: 'monthly', label: 'Monthly', cadence: 'Every month', discount: 100 },
  { frequency: 'quarterly', label: 'Quarterly', cadence: 'Every 3 months', discount: 75 },
  { frequency: 'biannual', label: 'Twice a year', cadence: 'Every 6 months', discount: 50 },
];
export const PLAN_DISCOUNT_MIN = 200;

export const presetDiscount = (f: RecurringFrequency): number | null =>
  PLAN_PRESETS.find(p => p.frequency === f)?.discount ?? null;

export const INTERVAL_UNITS: IntervalUnit[] = ['weeks', 'months', 'years'];

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', biannual: 'Twice a year', custom: 'Custom',
};

// "Quarterly", "Every 5 weeks", "Every 2 years", "Every month"
export function frequencyLabel(j: Pick<RecurringJob, 'frequency' | 'customInterval' | 'customIntervalUnit'>): string {
  if (j.frequency !== 'custom') return FREQ_LABEL[j.frequency];
  const n = j.customInterval ?? 1;
  const unit = j.customIntervalUnit ?? 'weeks';
  return n === 1 ? `Every ${unit.slice(0, -1)}` : `Every ${n} ${unit}`;
}

// The plan discount comes off a job's price only when the job is over the
// minimum, same rule as the website. Returns the $ amount actually taken off.
export function discountFor(price: number | null | undefined, discount: number | null | undefined): number {
  if (!price || !discount || discount <= 0 || price <= PLAN_DISCOUNT_MIN) return 0;
  return Math.min(discount, price);
}

export const profileHref = (recurringId: string, from?: string) =>
  `/admin/recurring/${recurringId}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
