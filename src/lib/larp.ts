// LARP mode — a joke button (Settings, top-left of "Save changes") that fills
// the CRM with fake bookings so the dashboard looks busy and booked out.
// Every fake row's id starts with LARP_PREFIX, which is the only thing that
// makes it fake — no separate "isLarp" column needed. Turning LARP mode off
// deletes exactly the rows with that prefix (see deleteBookingsByIdPrefix in
// db.ts) and can never touch a real booking (real ids are always
// `BK-<timestamp>`).
//
// Design notes:
// - Every stat/chart on the dashboard (revenue by month, top suburbs, status
//   counts, the internal calendar) reads straight from the bookings table, so
//   seeding realistic rows here is the ONLY code needed to make "the numbers
//   add up" everywhere else — no other read-path changes required.
// - No fake booking is ever left in status "pending". That status is what the
//   14-day stale-lead job watches (see checkStaleLeads in db.ts); leaving fake
//   pending leads around would make LARP mode trigger the real "moved to Cold
//   Lead" popup with fake customers in it.
// - At very high revenue targets, job COUNT scales up rather than individual
//   job prices — a two-person window cleaning business doing $1M/yr from
//   $150-3000 jobs means a lot of jobs, not a few enormous ones. That's the
//   realistic (if extreme) version of "make us look rich."

import crypto from 'crypto';
import type { Booking, BookingStatus, LeadSource, RecurringJob, RecurringFrequency } from './db';
import { type Invoice, type InvoiceLineItem, type InvoiceStatus, type PaymentMethod, BUSINESS_DEFAULTS, PAYMENT_DEFAULTS } from './invoice';

export const LARP_ID_PREFIX = 'LARP-';
export const LARP_MIN_REVENUE = 10000;
export const LARP_MAX_REVENUE = 1000000;

type Tier = 'premium' | 'upper' | 'mid' | 'value';

const SUBURBS: { name: string; tier: Tier; weight: number }[] = [
  // Premium — low weight, high ticket
  { name: 'Forrest', tier: 'premium', weight: 1 },
  { name: 'Griffith', tier: 'premium', weight: 2 },
  { name: 'Red Hill', tier: 'premium', weight: 2 },
  { name: 'Yarralumla', tier: 'premium', weight: 2 },
  { name: 'Deakin', tier: 'premium', weight: 2 },
  { name: 'Garran', tier: 'premium', weight: 2 },
  { name: 'Campbell', tier: 'premium', weight: 2 },
  { name: "O'Malley", tier: 'premium', weight: 1 },
  // Upper-mid
  { name: 'Aranda', tier: 'upper', weight: 3 },
  { name: 'Hughes', tier: 'upper', weight: 3 },
  { name: 'Curtin', tier: 'upper', weight: 3 },
  { name: 'Chifley', tier: 'upper', weight: 3 },
  { name: 'Farrer', tier: 'upper', weight: 3 },
  { name: 'Cook', tier: 'upper', weight: 3 },
  { name: 'Ainslie', tier: 'upper', weight: 4 },
  { name: 'Watson', tier: 'upper', weight: 3 },
  { name: 'Downer', tier: 'upper', weight: 3 },
  { name: 'Weston', tier: 'upper', weight: 3 },
  { name: 'Reid', tier: 'upper', weight: 2 },
  // Mid — the bulk of the volume
  { name: 'Belconnen', tier: 'mid', weight: 5 },
  { name: 'Bruce', tier: 'mid', weight: 4 },
  { name: 'Kaleen', tier: 'mid', weight: 5 },
  { name: 'Page', tier: 'mid', weight: 4 },
  { name: 'Dickson', tier: 'mid', weight: 4 },
  { name: 'Lyneham', tier: 'mid', weight: 4 },
  { name: 'Turner', tier: 'mid', weight: 3 },
  { name: 'Braddon', tier: 'mid', weight: 4 },
  { name: 'Gungahlin', tier: 'mid', weight: 6 },
  { name: 'Franklin', tier: 'mid', weight: 4 },
  { name: 'Harrison', tier: 'mid', weight: 4 },
  { name: 'Casey', tier: 'mid', weight: 4 },
  { name: 'Ngunnawal', tier: 'mid', weight: 4 },
  { name: 'Crace', tier: 'mid', weight: 3 },
  { name: 'Forde', tier: 'mid', weight: 3 },
  { name: 'Nicholls', tier: 'mid', weight: 3 },
  { name: 'Wright', tier: 'mid', weight: 3 },
  { name: 'Coombs', tier: 'mid', weight: 3 },
  // Value — lower ticket, still decent volume
  { name: 'Charnwood', tier: 'value', weight: 3 },
  { name: 'Latham', tier: 'value', weight: 3 },
  { name: 'Macgregor', tier: 'value', weight: 3 },
  { name: 'Melba', tier: 'value', weight: 3 },
  { name: 'Higgins', tier: 'value', weight: 3 },
  { name: 'Holt', tier: 'value', weight: 3 },
  { name: 'Kambah', tier: 'value', weight: 4 },
  { name: 'Wanniassa', tier: 'value', weight: 3 },
  { name: 'Gowrie', tier: 'value', weight: 2 },
  { name: 'Monash', tier: 'value', weight: 3 },
  { name: 'Chisholm', tier: 'value', weight: 2 },
  { name: 'Richardson', tier: 'value', weight: 2 },
  { name: 'Theodore', tier: 'value', weight: 2 },
];

const TIER_RANGE: Record<Tier, [number, number]> = {
  premium: [1300, 2800],
  upper: [850, 1750],
  mid: [500, 1050],
  value: [180, 600],
};

// Deliberately not a mono-culture list — mixes Anglo, Indian, Vietnamese,
// Chinese, Italian and Greek Australian names, roughly matching a real
// Canberra customer base.
const FIRST_NAMES = [
  'James', 'Sarah', 'Michael', 'Emma', 'David', 'Olivia', 'Chris', 'Sophie', 'Daniel', 'Emily',
  'Priya', 'Raj', 'Anjali', 'Vikram', 'Aisha', 'Arjun', 'Deepika', 'Rohan', 'Neha', 'Sanjay',
  'Minh', 'Linh', 'Duc', 'Trang', 'Hoa',
  'Marco', 'Giulia', 'Nikolas', 'Elena', 'Antonio',
  'Wei', 'Mei', 'Jason', 'Grace', 'Liam', 'Chloe', 'Ben', 'Hannah', 'Josh', 'Natalie',
  'Tony', 'Anna', 'George', 'Maria', 'Peter', 'Kate', 'Andrew', 'Rachel', 'Simon', 'Laura',
];
const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Wilson', 'Anderson', 'Thomas', 'Jackson', 'White',
  'Patel', 'Sharma', 'Kumar', 'Singh', 'Reddy', 'Gupta', 'Chopra', 'Iyer',
  'Nguyen', 'Tran', 'Le', 'Pham', 'Vo',
  'Rossi', 'Bianchi', 'Papadopoulos', 'Costa', 'Moretti',
  'Chen', 'Wang', 'Liu', 'Zhang',
  'Martin', 'Clark', 'Lewis', 'Walker', 'Young', 'King', 'Scott', 'Green', 'Baker', 'Hall',
];
const BUSINESS_KINDS = [
  'Cafe', 'Dental', 'Medical Centre', 'Realty', 'Physio', 'Accounting', 'Legal', 'Vet Clinic',
  'Childcare', 'Hair Studio', 'Fitness', 'Bakery', 'Pharmacy', 'Motors',
];

const ADMIN_NOTES = [
  'Stingy customer', 'Nice bloke, tips well', '45 windows', 'Big place, bring extra water',
  'Dog in yard, watch out', 'Gate code 1234', 'Paid cash, no worries', 'Fussy about streaks',
  'Ladder needed for upstairs', 'Elderly couple, lovely', 'Ring doorbell twice', 'Park on street, no driveway',
  'Tenants, landlord pays', 'Wants quarterly', 'Screens were filthy', 'Quick job, in and out',
  'Bit of a chat, ran long', 'Access via side gate', 'Referred by neighbour', 'Watch the sensor light',
];
const CUSTOMER_NOTES = [
  'Please call before arriving', 'Dog is friendly but loud', 'Access from the back',
  'Happy to leave a key with neighbour', "We're usually home after 2pm", 'No need to knock, just get started',
];
const STREET_NAMES = [
  'Cooyong', 'Antill', 'Redfern', 'Wattle', 'Currong', 'Bunda', 'Elouera', 'Blackall', 'Marcus Clarke',
  'Limestone', 'Mouat', 'Wisdom', 'Cameron', 'Templeton', 'Hindmarsh', 'Kitchener', 'Dryandra', 'Weedon',
  'Hodgson', 'Erindale', 'Sulwood', 'Athllon', 'Heard', 'Kett', 'Wybalena', 'Boolimba', 'Bugden', 'Namatjira',
];
const STREET_TYPES = ['St', 'Ave', 'Cres', 'Pl', 'Cct', 'Dr', 'Way', 'Cl'];
const EMAIL_PROVIDERS = ['gmail.com', 'outlook.com', 'hotmail.com', 'bigpond.com', 'yahoo.com'];

function weightedPick<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const it of items) { r -= it.weight; if (r <= 0) return it; }
  return items[items.length - 1];
}
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
// Average of two uniform draws — cheap triangular distribution, clusters
// toward the middle of the range instead of flat-uniform.
const triangular = (min: number, max: number) => min + ((Math.random() + Math.random()) / 2) * (max - min);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const INVOICE_SERVICE_LABEL: Record<string, string> = {
  'window-washing': 'Window Cleaning',
  'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'other': 'Cleaning Service',
};
function invoiceServiceLabel(service: string): string {
  return service.split(',').map(s => INVOICE_SERVICE_LABEL[s] ?? s).join(' + ') || 'Cleaning Service';
}

function jobValue(tier: Tier, commercial: boolean): number {
  const [lo, hi] = TIER_RANGE[tier];
  let v = triangular(lo, hi);
  if (commercial) v *= 1.15 + Math.random() * 0.25;
  v = Math.max(150, Math.min(3000, v));
  return Math.round(v / 5) * 5;
}

function fakeAddress(): string {
  const num = 1 + Math.floor(Math.random() * 180);
  return `${num} ${pick(STREET_NAMES)} ${pick(STREET_TYPES)}`;
}
function fakePhone(): string {
  const d = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  return `04${d[0]}${d[1]} ${d[2]}${d[3]}${d[4]} ${d[5]}${d[6]}${d[7]}`;
}
function fakeEmail(first: string, last: string): string {
  const suffix = Math.random() < 0.3 ? String(Math.floor(Math.random() * 99)) : '';
  return `${first.toLowerCase()}.${last.toLowerCase()}${suffix}@${pick(EMAIL_PROVIDERS)}`;
}
function pickService(): string {
  const r = Math.random();
  if (r < 0.55) return 'window-washing';
  if (r < 0.72) return 'pressure-washing';
  if (r < 0.82) return 'window-washing,pressure-washing';
  if (r < 0.93) return 'solar-panel-cleaning';
  return 'flyscreen-repair';
}
function businessHour(day: Date): Date {
  const hour = 8 + Math.floor(Math.random() * 8); // 8am - 3pm starts
  const minute = pick([0, 15, 30, 45]);
  const dt = new Date(day);
  dt.setHours(hour, minute, 0, 0);
  return dt;
}
const LEAD_SOURCES: LeadSource[] = ['called-us', 'we-called', 'door-to-door', 'in-person', 'real-estate', 'other'];

let nameSeq = 0;
function makeName(usedNames: Set<string>, commercial: boolean, suburb: string): string {
  if (commercial) {
    return `${suburb} ${pick(BUSINESS_KINDS)}`;
  }
  for (let tries = 0; tries < 20; tries++) {
    const full = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    if (!usedNames.has(full)) { usedNames.add(full); return full; }
  }
  nameSeq += 1;
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${nameSeq}`;
}

function makeLarpBooking(day: Date, today0: Date, histStart: Date, usedNames: Set<string>, index: number): Booking {
  const now = new Date().toISOString();
  const suburbInfo = weightedPick(SUBURBS);
  const commercial = Math.random() < 0.12;
  const isFuture = day.getTime() > today0.getTime();
  const value = jobValue(suburbInfo.tier, commercial);
  const name = makeName(usedNames, commercial, suburbInfo.name);
  const [first, last] = commercial ? ['', ''] : name.split(' ');
  const fromWebsite = Math.random() < 0.72;

  let status: BookingStatus;
  let paid = false;
  let scheduledAt: string | null = null;
  let scheduledEnd: string | null = null;
  let completedAt: string | null = null;
  let paidAt: string | null = null;
  let createdAtDate: Date;

  if (isFuture) {
    // Never "pending" — see file header. Mostly booked in, a few still just quoted.
    status = Math.random() < 0.88 ? 'confirmed' : 'quoted';
    if (status === 'confirmed') {
      const start = businessHour(day);
      scheduledAt = start.toISOString();
      scheduledEnd = new Date(start.getTime() + (60 + Math.floor(Math.random() * 120)) * 60000).toISOString();
    }
    const bookedDaysAgo = Math.floor(Math.random() * 20);
    createdAtDate = new Date(Math.max(addDays(today0, -bookedDaysAgo).getTime(), histStart.getTime()));
  } else {
    const start = businessHour(day);
    scheduledAt = start.toISOString();
    scheduledEnd = new Date(start.getTime() + (60 + Math.floor(Math.random() * 120)) * 60000).toISOString();
    const r = Math.random();
    if (r < 0.82) { status = 'completed'; paid = true; }
    else if (r < 0.95) { status = 'completed'; paid = false; }
    else { status = 'cancelled'; }
    if (status === 'completed') {
      completedAt = new Date(start.getTime() + (2 + Math.random() * 4) * 3600000).toISOString();
      if (paid) {
        const paidDelayDays = Math.floor(Math.random() * 8);
        paidAt = new Date(Math.min(addDays(new Date(completedAt), paidDelayDays).getTime(), today0.getTime())).toISOString();
      }
    }
    const leadDays = 1 + Math.floor(Math.random() * 6);
    createdAtDate = new Date(Math.max(addDays(day, -leadDays).getTime(), histStart.getTime()));
  }

  const manual = !fromWebsite;
  return {
    id: `${LARP_ID_PREFIX}${Date.now()}-${index}`,
    name,
    email: commercial ? '' : fakeEmail(first, last),
    phone: fakePhone(),
    service: pickService() as Booking['service'],
    propertyType: commercial ? 'commercial' : 'residential',
    address: fakeAddress(),
    suburb: suburbInfo.name,
    preferredDate: '',
    preferredTime: '',
    notes: !commercial && Math.random() < 0.15 ? pick(CUSTOMER_NOTES) : '',
    status,
    quoteAmount: value,
    adminNotes: Math.random() < 0.35 ? pick(ADMIN_NOTES) : '',
    paid,
    source: manual ? 'manual' : 'website',
    paidAt,
    customerMarkedPaidAt: null,
    completedAt,
    assignedGuestId: null,
    assignedAt: null,
    scheduledAt,
    scheduledEnd,
    recurringId: null,
    leadSource: manual ? pick(LEAD_SOURCES) : null,
    groupId: null,
    publicToken: `bk_${crypto.randomBytes(12).toString('hex')}`,
    feedbackStars: null,
    feedbackText: null,
    feedbackAt: null,
    contactedAt: null,
    sortOrder: null,
    autoMoved: false,
    autoMovedAt: null,
    autoMovedFrom: null,
    createdAt: createdAtDate.toISOString(),
    updatedAt: now,
  };
}

// Builds the full fake booking set for a given revenue target. Story arc:
// sparse weekend-only jobs from ~5 months back, ramping up from ~10 weeks ago,
// peaking ~8 weeks ago and holding high since, then a future pipeline that
// tapers off the further out it goes (all offsets are relative to "now", so
// this stays coherent no matter when it's actually run).
export function buildLarpBookings(revenueTarget: number): Booking[] {
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const peakStart = addDays(today0, -55);
  const rampStart = addDays(today0, -72);
  const histStart = addDays(rampStart, -70);
  const futureEnd = addDays(today0, 42);

  // Divisor tuned empirically against the actual generated mix (most jobs paid,
  // some future/cancelled/unpaid diluting it) so the slider lands close to its
  // target revenue rather than a token fraction of it.
  const target = Math.max(LARP_MIN_REVENUE, Math.min(LARP_MAX_REVENUE, revenueTarget));
  const totalJobs = Math.max(30, Math.min(1700, Math.round(target / 650)));

  const density = (d: Date): number => {
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (d.getTime() < histStart.getTime()) return 0;
    if (d.getTime() < rampStart.getTime()) return isWeekend ? 0.15 : 0;
    if (d.getTime() < peakStart.getTime()) {
      const frac = (d.getTime() - rampStart.getTime()) / (peakStart.getTime() - rampStart.getTime());
      return 0.2 + frac * 0.8;
    }
    if (d.getTime() <= today0.getTime()) return 0.9 + Math.random() * 0.3;
    const daysOut = (d.getTime() - today0.getTime()) / 86400000;
    return Math.max(0, 1 - daysOut / 42) * 0.7;
  };

  const days: Date[] = [];
  for (let d = histStart; d.getTime() <= futureEnd.getTime(); d = addDays(d, 1)) days.push(d);
  const weights = days.map(density);
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;

  const bookings: Booking[] = [];
  const usedNames = new Set<string>();
  let seq = 0;
  days.forEach((day, i) => {
    const expected = (weights[i] / totalWeight) * totalJobs;
    const count = Math.floor(expected) + (Math.random() < expected - Math.floor(expected) ? 1 : 0);
    for (let j = 0; j < count; j++) bookings.push(makeLarpBooking(day, today0, histStart, usedNames, seq++));
  });

  return bookings;
}

// One invoice per fake booking (skipping cancelled jobs — you don't invoice
// work that didn't happen). Numbers start at GB9000+, deliberately far above
// where the real sequence will realistically be, and are inserted via
// insertRawInvoice() which bypasses the atomic invoice_counter entirely — so
// this can never collide with, or disturb, real invoice numbering.
export function buildLarpInvoices(bookings: Booking[]): Invoice[] {
  const now = new Date().toISOString();
  const invoices: Invoice[] = [];
  let i = 0;
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    if (typeof b.quoteAmount !== 'number' || b.quoteAmount <= 0) continue;
    i += 1;
    const seq = 9000 + i;
    const amount = b.quoteAmount;
    const items: InvoiceLineItem[] = [{
      description: invoiceServiceLabel(b.service),
      detail: '',
      serviceAddress: [b.address, b.suburb].filter(Boolean).join(', '),
      date: (b.completedAt ?? b.scheduledAt ?? b.createdAt).slice(0, 10),
      amount,
    }];

    let status: InvoiceStatus;
    let sentAt: string | null = null;
    let paidAt: string | null = null;
    let paymentMethod: PaymentMethod | null = null;
    let invoiceDate: string;
    let dueDate: string;

    if (b.status === 'completed' && b.paid) {
      status = 'paid';
      invoiceDate = (b.completedAt ?? b.createdAt).slice(0, 10);
      sentAt = b.completedAt ?? b.createdAt;
      dueDate = addDaysStr(invoiceDate, 14);
      paidAt = b.paidAt ?? sentAt;
      paymentMethod = pick<PaymentMethod>(['bank_transfer', 'bank_transfer', 'bank_transfer', 'cash', 'card']);
    } else if (b.status === 'completed' && !b.paid) {
      status = 'sent';
      invoiceDate = (b.completedAt ?? b.createdAt).slice(0, 10);
      sentAt = b.completedAt ?? b.createdAt;
      dueDate = addDaysStr(invoiceDate, 14);
    } else {
      // Confirmed/quoted future work — prepped ahead of time, not sent yet.
      status = 'draft';
      invoiceDate = b.createdAt.slice(0, 10);
      dueDate = addDaysStr(invoiceDate, 14);
    }

    const viewed = status !== 'draft' && Math.random() < 0.6;

    invoices.push({
      id: `${LARP_ID_PREFIX}INV-${Date.now()}-${i}`,
      number: `GB${seq}`,
      seq,
      isTaxInvoice: false,
      status,
      paymentMethod,
      ...BUSINESS_DEFAULTS,
      showFromAddress: true,
      billToName: b.name,
      billToLines: '',
      client: { show: false, clientName: '', trn: '', fileNo: '', claimRef: '' },
      invoiceDate, serviceDate: invoiceDate, dueDate,
      items, subtotal: amount, total: amount,
      notes: '',
      ...PAYMENT_DEFAULTS,
      token: `inv_${crypto.randomBytes(12).toString('hex')}`,
      bookingId: b.id,
      bookingIds: [b.id],
      ownerGuestId: null,
      createdAt: now, updatedAt: now, sentAt, paidAt,
      viewCount: viewed ? 1 + Math.floor(Math.random() * 3) : 0,
      firstViewedAt: viewed ? sentAt : null,
      lastViewedAt: viewed ? sentAt : null,
      squarePaymentLinkUrl: null, squareOrderId: null, squarePaymentId: null, squareLinkAmount: null, squarePaidAt: null,
    });
  }
  return invoices;
}

// A handful of recurring customers so /admin/recurring looks lived-in too.
// nextDate is kept 60-90 days out on purpose — belt and braces alongside the
// id-prefix skip in runRecurringDue() (db.ts) so these can never get
// auto-booked into a real, untagged booking by the daily cron.
export function buildLarpRecurringPlans(count = 8): RecurringJob[] {
  const now = new Date().toISOString();
  const frequencies: RecurringFrequency[] = ['monthly', 'monthly', 'monthly', 'quarterly', 'quarterly', 'biannual'];
  const usedNames = new Set<string>();
  const plans: RecurringJob[] = [];
  for (let i = 0; i < count; i++) {
    const suburbInfo = weightedPick(SUBURBS);
    const commercial = Math.random() < 0.15;
    const name = makeName(usedNames, commercial, suburbInfo.name);
    const [first, last] = commercial ? ['', ''] : name.split(' ');
    const nextDate = addDaysStr(new Date().toISOString().slice(0, 10), 60 + Math.floor(Math.random() * 30));
    plans.push({
      id: `${LARP_ID_PREFIX}RJ-${Date.now()}-${i}`,
      name,
      phone: fakePhone(),
      email: commercial ? '' : fakeEmail(first, last),
      address: fakeAddress(),
      suburb: suburbInfo.name,
      service: pickService(),
      propertyType: commercial ? 'commercial' : 'residential',
      frequency: pick(frequencies),
      nextDate,
      preferredTime: pick(['Morning', 'Afternoon', '9am', '1pm']),
      notes: Math.random() < 0.3 ? pick(ADMIN_NOTES) : '',
      discount: Math.random() < 0.3 ? pick([10, 15, 20, 25]) : null,
      active: true,
      lastBookingId: null,
      createdAt: now,
      updatedAt: now,
    });
  }
  return plans;
}
