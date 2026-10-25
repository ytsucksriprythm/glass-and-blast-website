// The recurring customer service agreement, built from the customer's plan
// (frequency, discount, price) and the contract settings (term, cancel fee,
// cooling-off). Client-safe: no db imports. The customer signs it in the
// portal (/portal/[token]); at signing, the terms + full text are snapshotted
// onto their profile so later setting changes never alter a signed contract.
//
// Written to Australian Consumer Law expectations: plain language, obligations
// on both sides, a cooling-off period, no-fee exit if we don't deliver, and
// ACL guarantees preserved. Not legal advice — have it reviewed before use.
import type { RecurringJob } from '@/lib/db';
import type { AppSettings } from '@/lib/settings';
import { PLAN_DISCOUNT_MIN, discountFor } from '@/lib/recurring';

export const CONTRACT_VERSION = 1;

export interface ContractParty { name: string; tradingAs?: string; abn?: string; address: string; phone: string; email: string }

export interface ContractTerms {
  business: ContractParty;
  customer: ContractParty;
  services: string;
  cadenceText: string;     // "4 times a year (every 3 months)"
  visitsPerTerm: number;
  termMonths: number;
  cancelFeePercent: number;
  feeFirstTermOnly: boolean;
  coolingOffDays: number;
  visitPrice: number | null;     // usual price per visit before discount
  discount: number | null;       // $ off per visit
  discountMin: number;           // discount applies to jobs over this
  pricePerVisit: number | null;  // what they pay per visit after discount
  extraTerms: string;
}

export interface ContractSection { heading: string; body: string[] }

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'window cleaning', 'pressure-washing': 'pressure washing', both: 'window cleaning and pressure washing',
  'flyscreen-repair': 'flyscreen repair', 'solar-panel-cleaning': 'solar panel cleaning', other: 'other agreed services',
};
const serviceWords = (s: string) => {
  const list = (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x);
  if (list.length <= 1) return list[0] ?? 'window cleaning';
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const monthsWord = (m: number) => `${m} month${m === 1 ? '' : 's'}`;

// Length of one gap between visits, as weeks or months.
function cadence(j: Pick<RecurringJob, 'frequency' | 'customInterval' | 'customIntervalUnit'>): { weeks?: number; months?: number } {
  switch (j.frequency) {
    case 'weekly': return { weeks: 1 };
    case 'fortnightly': return { weeks: 2 };
    case 'monthly': return { months: 1 };
    case 'quarterly': return { months: 3 };
    case 'biannual': return { months: 6 };
    default: {
      const n = Math.max(1, j.customInterval || 1);
      const u = j.customIntervalUnit ?? 'weeks';
      return u === 'weeks' ? { weeks: n } : { months: u === 'years' ? n * 12 : n };
    }
  }
}
const visitsIn = (months: number, c: { weeks?: number; months?: number }) =>
  c.weeks ? Math.floor((months / 12) * 52 / c.weeks) : Math.floor(months / (c.months ?? 12));

const timesWord = (n: number) => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;

export function cadenceText(j: Pick<RecurringJob, 'frequency' | 'customInterval' | 'customIntervalUnit'>): string {
  const c = cadence(j);
  const perYear = visitsIn(12, c);
  const every = c.weeks
    ? (c.weeks === 1 ? 'every week' : c.weeks === 2 ? 'every fortnight' : `every ${c.weeks} weeks`)
    : (c.months === 1 ? 'every month' : c.months === 12 ? 'every year' : c.months! % 12 === 0 ? `every ${c.months! / 12} years` : `every ${c.months} months`);
  if (perYear < 1) return every;
  return `${timesWord(perYear)} a year (${every})`;
}

export function buildContractTerms(job: RecurringJob, settings: AppSettings, business: ContractParty): ContractTerms {
  const termMonths = settings.contractTermMonths;
  const off = job.visitPrice != null ? discountFor(job.visitPrice, job.discount) : 0;
  return {
    business,
    customer: {
      name: job.name,
      address: [job.address, job.suburb].filter(Boolean).join(', '),
      phone: job.phone,
      email: job.email,
    },
    services: serviceWords(job.service),
    cadenceText: cadenceText(job),
    visitsPerTerm: Math.max(1, visitsIn(termMonths, cadence(job))),
    termMonths,
    cancelFeePercent: settings.contractCancelFeePercent,
    feeFirstTermOnly: settings.contractFeeFirstTermOnly,
    coolingOffDays: settings.contractCoolingOffDays,
    visitPrice: job.visitPrice,
    discount: job.discount,
    discountMin: PLAN_DISCOUNT_MIN,
    pricePerVisit: job.visitPrice != null ? job.visitPrice - off : null,
    extraTerms: settings.contractExtraTerms.trim(),
  };
}

// The agreement, section by section. `startDate` is the signing date (shown as
// "the day you sign" before signing).
export function contractSections(t: ContractTerms, startDate?: string): ContractSection[] {
  const b = t.business;
  const us = b.tradingAs ? `${b.name} trading as ${b.tradingAs}` : b.name;
  const start = startDate
    ? new Date(`${startDate}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'the day you sign this agreement';
  const visits = `${t.visitsPerTerm} visit${t.visitsPerTerm === 1 ? '' : 's'}`;
  const pct = `${t.cancelFeePercent}%`;

  const price: string[] = [];
  if (t.visitPrice != null) {
    price.push(`Our usual price for each visit at your property is ${money(t.visitPrice)} (GST included if applicable).`);
    if (t.discount && t.pricePerVisit != null && t.pricePerVisit < t.visitPrice) {
      price.push(`As a plan customer you get ${money(t.discount)} off each visit, so you pay ${money(t.pricePerVisit)} per visit.`);
    } else if (t.discount) {
      price.push(`As a plan customer you get ${money(t.discount)} off any visit priced over ${money(t.discountMin)}.`);
    }
  } else {
    price.push('We will quote the price of each visit before it goes ahead.');
    if (t.discount) price.push(`As a plan customer you get ${money(t.discount)} off each visit priced over ${money(t.discountMin)}.`);
  }
  if (t.discount) {
    price.push(`If you ask for more visits than the ${visits} in a term, those extra visits also get your plan discount (on visits priced over ${money(t.discountMin)}).`);
  }
  price.push('We send an invoice after each visit. Payment is due by the date shown on the invoice.');
  price.push(`Your per-visit price stays the same for the first ${monthsWord(t.termMonths)}. Before a renewal we may change the price by telling you in writing at least 30 days before the renewal date. If you don't accept the new price you can cancel before the renewal date with no cancellation fee.`);

  const example = t.pricePerVisit != null
    ? `For example, if 2 visits were left at ${money(t.pricePerVisit)} each, the fee would be ${pct} of ${money(t.pricePerVisit * 2)}, which is ${money(Math.round(t.pricePerVisit * 2 * t.cancelFeePercent) / 100)}.`
    : `For example, if 2 visits were left at $500 each, the fee would be ${pct} of $1,000, which is ${money(10 * t.cancelFeePercent)}.`;

  const cancel: string[] = [];
  if (t.coolingOffDays > 0) {
    cancel.push(`Cooling-off: you can cancel this agreement for any reason within ${t.coolingOffDays} business days after the day you sign it, with no cancellation fee. You only pay for any visit already carried out at your request.`);
  }
  if (t.cancelFeePercent > 0) {
    cancel.push(`After that, you can cancel at any time by telling us (by text, email or phone). If you cancel during the ${t.feeFirstTermOnly ? 'first term' : 'a term'}, a cancellation fee of ${pct} of the total price of the visits still remaining in that term applies (remaining visits × your per-visit price). ${example}`);
    cancel.push('This fee is a reasonable estimate of what it costs us to hold your visits in our schedule and to have given you the plan discount. It is not a penalty.');
    if (t.feeFirstTermOnly) cancel.push(`Once the first ${monthsWord(t.termMonths)} have passed, you can cancel at any time with no cancellation fee.`);
    else cancel.push('You can also cancel with no fee by telling us before a renewal date; the cancellation then takes effect at the end of the current term.');
  } else {
    cancel.push('After that, you can cancel at any time by telling us (by text, email or phone), with no cancellation fee.');
  }
  cancel.push('You never pay a cancellation fee if we have failed to provide the visits in this agreement, or if we have otherwise seriously breached it.');
  cancel.push('We can end this agreement at any time by telling you in writing. If we do, you owe nothing other than the price of visits already carried out.');
  cancel.push('Any visits already carried out must still be paid for.');

  const sections: ContractSection[] = [
    {
      heading: '1. Who this agreement is between',
      body: [
        `This agreement is between ${us}${b.abn ? ` (ABN ${b.abn})` : ''}${b.address ? `, ${b.address}` : ''} ("we", "us"), and ${t.customer.name}${t.customer.address ? ` of ${t.customer.address}` : ''} ("you").`,
      ],
    },
    {
      heading: '2. What we will do',
      body: [
        `We will provide ${t.services} at ${t.customer.address || 'your property'} ${t.cadenceText}.`,
        `That is ${visits} in each ${t.termMonths}-month term. We will arrange each visit with you ahead of time.`,
        'If we can\'t make a visit (for example because of bad weather or safety), we will rebook it as soon as reasonably possible. You can also ask us to move a visit, and we\'ll find another time.',
        'We will carry out the work with due care and skill, and fix anything we get wrong at no cost to you.',
      ],
    },
    {
      heading: '3. What you will do',
      body: [
        'Give us safe access to the areas being cleaned at the agreed times, and let us know about anything we should be careful of (pets, alarms, fragile items, access codes).',
        'If we can\'t get access at an agreed time, we will arrange another time with you.',
        'Pay each invoice by its due date.',
      ],
    },
    { heading: '4. Price and discount', body: price },
    {
      heading: '5. How long this agreement lasts',
      body: [
        `This agreement starts on ${start} and runs for ${monthsWord(t.termMonths)} (the "first term").`,
        `At the end of each term it renews automatically for another ${monthsWord(t.termMonths)}, on the same terms, unless you or we cancel it.`,
      ],
    },
    { heading: '6. Cancelling', body: cancel },
    {
      heading: '7. Your rights under the Australian Consumer Law',
      body: [
        'Our services come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in this agreement excludes, restricts or changes any right or remedy you have under that law.',
      ],
    },
    {
      heading: '8. Your details',
      body: [
        'We use your details only to provide this service and contact you about it, as set out in our privacy policy at glassandblast.com.au/privacy.',
      ],
    },
    {
      heading: '9. Signing and notices',
      body: [
        'You agree to sign this agreement electronically. Your typed name and drawn signature have the same effect as a handwritten signature. A copy of the signed agreement stays available in your customer portal.',
        `Notices under this agreement can be given by text, email or phone using the contact details we each have on file${b.phone || b.email ? ` (ours: ${[b.phone, b.email].filter(Boolean).join(', ')})` : ''}.`,
        'This agreement is governed by the law of the Australian Capital Territory.',
      ],
    },
  ];
  if (t.extraTerms) sections.push({ heading: '10. Additional terms', body: t.extraTerms.split(/\n+/).map(s => s.trim()).filter(Boolean) });
  return sections;
}

export function contractTitle(t: ContractTerms): string {
  return `${t.business.tradingAs || t.business.name} Recurring Service Agreement`;
}

// Plain-text version (what gets stored with the signature).
export function contractText(t: ContractTerms, startDate?: string): string {
  const parts = [contractTitle(t).toUpperCase(), ''];
  for (const s of contractSections(t, startDate)) {
    parts.push(s.heading, ...s.body, '');
  }
  return parts.join('\n').trim();
}
