import { z } from 'zod';
import { getBookingsInRange, getSettings, listCallingRecords, logActivity, saveCallingRecord, updateSettings, type CallingPatch, type CallingRecord } from './db';
import { ATTEMPT_OUTCOMES, CALL_OUTCOMES, DEFAULT_CALL_POLICY, LEASE_MS, sydneyDay, type CallEvent, type CallPolicy } from './callingTypes';
import { STAFF_PROFILES, type StaffProfile } from './staff';
import { syncBookingStatusToSheet } from './metaLeads';

export const staffSchema = z.enum(['liam', 'lincoln']);
export const services = ['window-washing', 'pressure-washing', 'solar-panel-cleaning', 'flyscreen-repair', 'other', 'both'] as const;
export const policySchema = z.object({
  retryHours: z.number().int().min(1).max(720),
  maxAttempts: z.number().int().min(1).max(20),
  priority: z.enum(['new-first', 'oldest-first']),
});
const instant = z.iso.datetime({ offset: true });
export const outcomeSchema = z.object({
  bookingId: z.string().min(1).max(120),
  requestId: z.string().min(8).max(120),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(8000).default(''),
  amends: z.string().max(120).optional(),
  recordAttempt: z.boolean().optional(),
  nextAt: instant.optional(),
  service: z.enum(services).optional(),
  assigned: staffSchema.nullable().optional(),
  appointmentNotes: z.string().trim().max(4000).optional(),
});
export type OutcomeInput = z.input<typeof outcomeSchema>;
type Actor = { staff: StaffProfile; session: string; channel?: 'chatgpt' | 'claude' | 'connector' };
export class CallingError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

function isOpen(record: CallingRecord) {
  return ['uncontacted', 'contacted'].includes(record.booking.status) || (record.booking.status === 'cold' && record.booking.autoMovedFrom === 'uncontacted');
}

function pending(record: CallingRecord) {
  const lastOutcome = record.state.events.findLast(event => ATTEMPT_OUTCOMES.has(event.outcome) || event.outcome === 'reopen');
  return !record.state.disposition && (record.booking.status === 'uncontacted' || (record.booking.status === 'cold' && isOpen(record)) ||
    (record.booking.status === 'contacted' && (!!record.state.nextAt || lastOutcome?.outcome === 'no-answer')));
}

function misses(record: CallingRecord) {
  const events = record.state.events;
  const reset = events.findLastIndex(event => ['reopen', 'callback', 'answered'].includes(event.outcome));
  return events.slice(reset + 1).filter(event => event.outcome === 'no-answer').length;
}

function needsReview(record: CallingRecord, policy: CallPolicy) {
  return pending(record) && misses(record) >= policy.maxAttempts;
}

function compareLeads(a: CallingRecord, b: CallingRecord, rules: CallPolicy) {
  const rank = (record: CallingRecord) => record.state.nextAt && record.state.events.some(event => event.outcome === 'callback' && event.nextAt === record.state.nextAt) ? 0 :
    (rules.priority === 'new-first' && misses(record) === 0 ? 1 : 2);
  return rank(a) - rank(b) ||
    (rank(a) === 0 ? (a.state.nextAt ?? '').localeCompare(b.state.nextAt ?? '') : 0) ||
    (rules.priority === 'new-first' ? misses(a) - misses(b) : 0) ||
    a.booking.createdAt.localeCompare(b.booking.createdAt);
}

function ready(record: CallingRecord, policy: CallPolicy, actor: { staff?: StaffProfile; session: string }, now: number) {
  const { booking, state } = record;
  return pending(record) && !!booking.phone.match(/\d/) && !needsReview(record, policy) &&
    (!state.nextAt || Date.parse(state.nextAt) <= now) &&
    (!actor.staff || !state.assigned || state.assigned === actor.staff) &&
    (!state.lease || state.lease.expires <= now || (state.lease.session === actor.session && state.lease.staff === actor.staff));
}

async function policy() {
  const parsed = policySchema.safeParse((await getSettings()).callPolicy);
  return parsed.success ? parsed.data : DEFAULT_CALL_POLICY;
}

export async function saveCallPolicy(input: CallPolicy) {
  return (await updateSettings({ callPolicy: policySchema.parse(input) })).callPolicy;
}

export async function callingSnapshot(actor: Actor, from?: string, to?: string) {
  const [records, rules] = await Promise.all([listCallingRecords(), policy()]);
  return summarizeCalls(records, rules, actor, from, to);
}

export function summarizeCalls(records: CallingRecord[], rules: CallPolicy, actor: { staff?: StaffProfile; session: string }, from?: string, to?: string) {
  const now = Date.now();
  const today = sydneyDay(now);
  const allEvents = records.flatMap(record => record.state.events);
  const events = allEvents.filter(event => {
    const day = sydneyDay(event.at);
    return day >= (from ?? today) && day <= (to ?? today);
  }).sort((a, b) => b.at.localeCompare(a.at));
  const rows = [...records].sort((a, b) => compareLeads(a, b, rules)).map(record => ({
    ...record,
    pending: pending(record),
    eligible: ready(record, rules, actor, now),
    review: needsReview(record, rules),
    reservedBy: record.state.lease && record.state.lease.expires > now ? record.state.lease.staff : null,
    attempts: record.state.events.filter(event => event.attempt !== null).length,
  }));
  const stats = Object.fromEntries((Object.keys(STAFF_PROFILES) as StaffProfile[]).map(staff => {
    const own = events.filter(event => event.staff === staff);
    return [staff, {
      attempted: own.filter(event => event.attempt !== null).length,
      answered: own.filter(event => ['answered', 'quote'].includes(event.outcome) && event.attempt !== null).length,
      quotes: own.filter(event => event.outcome === 'quote').length,
    }];
  })) as Record<StaffProfile, { attempted: number; answered: number; quotes: number }>;
  return { rows, stats, events, policy: rules };
}

export async function reserveCall(actor: Actor, bookingId?: string, excludedIds: string[] = []) {
  const [records, rules] = await Promise.all([listCallingRecords(), policy()]);
  const now = Date.now();
  const excluded = new Set(excludedIds);
  const sorted = records.filter(record => (!bookingId ? !excluded.has(record.booking.id) : record.booking.id === bookingId) && (ready(record, rules, actor, now) ||
    (bookingId && !record.state.disposition && record.state.lease?.session === actor.session && record.state.lease.staff === actor.staff && ['uncontacted', 'contacted'].includes(record.booking.status))))
    .sort((a, b) => compareLeads(a, b, rules));
  for (const record of sorted) {
    const state = { ...record.state, lease: { ...actor, expires: now + LEASE_MS } };
    if (await saveCallingRecord(record, state)) return { booking: record.booking, state };
  }
  if (bookingId) throw new CallingError('This lead is currently unavailable. Refresh the list before calling.');
  return null;
}

export async function releaseCall(actor: Actor, bookingId: string) {
  const record = (await listCallingRecords()).find(row => row.booking.id === bookingId);
  if (!record || record.state.lease?.session !== actor.session || record.state.lease.staff !== actor.staff) return;
  const { lease, ...state } = record.state;
  await saveCallingRecord(record, state);
}

export async function recordCall(actor: Actor, raw: OutcomeInput, requireLease = true) {
  const input = outcomeSchema.parse(raw);
  const [records, rules] = await Promise.all([listCallingRecords(), policy()]);
  const record = records.find(row => row.booking.id === input.bookingId);
  if (!record) throw new CallingError('Lead not found.', 404);
  const { booking, state: before } = record;
  const previous = before.events.find(event => event.id === input.requestId && event.staff === actor.staff);
  if (previous) return previous;
  const now = Date.now();
  const lease = before.lease;
  const owned = lease?.staff === actor.staff && lease.session === actor.session && lease.expires > now;
  if ((requireLease && !owned) || (lease && lease.expires > now && !owned)) throw new CallingError('This lead is reserved by another session or your reservation expired.');
  if (before.disposition === 'do-not-call' && !['note', 'reopen', 'assign'].includes(input.outcome)) {
    throw new CallingError('This lead requested do not call. Explicitly reopen it before scheduling further calls.');
  }
  const state = { ...before };
  const patch: CallingPatch = {};
  const { outcome } = input;
  if (outcome === 'note' && !input.notes) throw new CallingError('Enter a note to save.', 400);
  if (input.amends && (outcome !== 'note' || !before.events.some(event => event.id === input.amends && event.notes))) {
    throw new CallingError('Choose an existing call note to amend.', 400);
  }
  if (outcome === 'assign') state.assigned = input.assigned ?? null;
  if (outcome === 'reopen') {
    if (!['uncontacted', 'contacted', 'cold'].includes(booking.status)) throw new CallingError('This booking has already moved past the calling stage.');
    state.disposition = null;
    state.nextAt = null;
    patch.status = 'uncontacted';
  }
  if (outcome === 'callback' || outcome === 'quote') {
    if (!input.nextAt || Date.parse(input.nextAt) <= now) throw new CallingError('Choose a date and time in the future.', 400);
    if (!isOpen(record) || before.disposition) throw new CallingError('Reopen this lead before scheduling.');
  }
  if (outcome === 'callback') state.nextAt = new Date(input.nextAt!).toISOString();
  if (outcome === 'no-answer') {
    if (!pending(record)) throw new CallingError('This lead is no longer pending.');
    state.nextAt = misses(record) + 1 >= rules.maxAttempts ? null : new Date(now + rules.retryHours * 3600000).toISOString();
  }
  if (outcome === 'answered') {
    if (!isOpen(record) || before.disposition) throw new CallingError('This lead is no longer pending.');
    patch.status = 'contacted';
    state.nextAt = null;
  }
  if (outcome === 'not-interested' || outcome === 'do-not-call') {
    state.disposition = outcome;
    state.nextAt = null;
    if (isOpen(record)) patch.status = 'cold';
  }
  if (outcome === 'quote') {
    if (booking.scheduledAt) throw new CallingError('This lead already has a calendar appointment. Open the existing booking to reschedule it.');
    if (!input.assigned || !input.service) throw new CallingError('Choose a service and appointment assignee.', 400);
    const start = Date.parse(input.nextAt!);
    const end = start + 60 * 60 * 1000;
    const conflicts = await getBookingsInRange(new Date(start - 86400000).toISOString(), new Date(end).toISOString());
    if (conflicts.some(row => row.id !== booking.id && row.scheduledAt && !['cancelled', 'cold'].includes(row.status) &&
      (!row.quoteStaff || row.quoteStaff === input.assigned) && (row.scheduledEnd ? Date.parse(row.scheduledEnd) : Date.parse(row.scheduledAt) + 3600000) > start)) {
      throw new CallingError('This time overlaps a calendar appointment. Pick another time.');
    }
    Object.assign(patch, { status: 'quote-booked', scheduledAt: new Date(start).toISOString(), scheduledEnd: new Date(end).toISOString(), service: input.service, quoteStaff: input.assigned });
    state.quoteStaff = input.assigned;
    state.nextAt = null;
  }
  const at = new Date(now).toISOString();
  const notes = [input.amends ? 'Correction: ' + input.notes : input.notes, input.appointmentNotes ? 'Appointment: ' + input.appointmentNotes : ''].filter(Boolean).join('\n');
  const prior = before.events.findLast(event => ATTEMPT_OUTCOMES.has(event.outcome));
  const continuation = prior?.staff === actor.staff && prior.outcome === 'answered' && now - Date.parse(prior.at) < LEASE_MS;
  const event: CallEvent = {
    id: input.requestId, leadId: booking.id, staff: actor.staff, channel: actor.channel, at, outcome, notes, amends: input.amends,
    attempt: ATTEMPT_OUTCOMES.has(outcome) && input.recordAttempt !== false && !continuation ? before.events.filter(e => e.attempt !== null).length + 1 : null,
    nextAt: state.nextAt ?? null,
    quoteBookingId: outcome === 'quote' ? booking.id : null,
  };
  state.events = [...before.events, event];
  if (!['answered', 'note'].includes(outcome)) delete state.lease;
  if (notes) patch.noteLine = '[' + at + ' / ' + STAFF_PROFILES[actor.staff] + (actor.channel ? ' (' + actor.channel + ')' : '') + '] ' + notes;
  if (!await saveCallingRecord(record, state, patch)) throw new CallingError('The lead changed while saving. Refresh and retry.');
  await logActivity('booking.call', booking.name + ': ' + outcome.replaceAll('-', ' '), {
    bookingId: booking.id, eventId: event.id, outcome, attempt: event.attempt, nextAt: event.nextAt, quoteBookingId: event.quoteBookingId,
  }, STAFF_PROFILES[actor.staff] + (actor.channel ? ' (' + actor.channel + ')' : '')).catch(console.error);
  if (patch.status && patch.status !== booking.status) void syncBookingStatusToSheet({ ...booking, status: patch.status }).catch(console.error);
  return event;
}
