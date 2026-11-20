import type { StaffProfile } from './staff';

export const CALL_OUTCOMES = ['answered', 'no-answer', 'callback', 'not-interested', 'do-not-call', 'quote', 'note', 'reopen', 'assign'] as const;
export type CallOutcome = typeof CALL_OUTCOMES[number];
export type CallEvent = {
  id: string;
  leadId: string;
  staff: StaffProfile;
  channel?: "chatgpt" | "claude" | "connector";
  at: string;
  outcome: CallOutcome;
  notes: string;
  amends?: string;
  attempt: number | null;
  nextAt: string | null;
  quoteBookingId: string | null;
};
export type CallState = {
  events: CallEvent[];
  lease?: { staff: StaffProfile; session: string; expires: number };
  assigned?: StaffProfile | null;
  quoteStaff?: StaffProfile;
  nextAt?: string | null;
  disposition?: 'not-interested' | 'do-not-call' | null;
};
export type CallPolicy = { retryHours: number; maxAttempts: number; priority: 'new-first' | 'oldest-first' };
export const DEFAULT_CALL_POLICY: CallPolicy = { retryHours: 24, maxAttempts: 3, priority: 'new-first' };
export const LEASE_MS = 10 * 60 * 1000;
export const ATTEMPT_OUTCOMES = new Set<CallOutcome>(['answered', 'no-answer', 'callback', 'not-interested', 'do-not-call', 'quote']);
export function callState(raw: unknown): CallState {
  if (raw && typeof raw === 'object' && 'events' in raw && Array.isArray(raw.events)) return raw as CallState;
  return { events: [] };
}

const formatSydneyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });
export function sydneyDay(value: string | number | Date) {
  return formatSydneyDay.format(new Date(value));
}
