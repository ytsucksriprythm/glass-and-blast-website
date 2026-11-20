'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneCall } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { sydneyLocalToIso } from '@/lib/mcp/time';
import type { CallingRecord } from '@/lib/db';
import type { CallEvent, CallOutcome, CallPolicy } from '@/lib/callingTypes';
import type { OutcomeInput } from '@/lib/calling';
import { STAFF_PROFILES, type StaffProfile } from '@/lib/staff';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, adminNavItems, useMoreSheet } from '@/components/admin/AdminNav';
import { readStaffPreference, useStaffProfile, writeStaffPreference } from '@/components/admin/StaffSession';

const filters = ['All pending calls', 'Never contacted', 'No answer / callback required', 'Contacted', 'Quote booked', 'Review', 'Excluded'] as const;
const serviceOptions = {
  'window-washing': 'Window cleaning', 'pressure-washing': 'Pressure washing', 'solar-panel-cleaning': 'Solar panels',
  'flyscreen-repair': 'Flyscreen repair', both: 'Window and pressure washing', other: 'Other',
} as const;
const labels: Record<CallOutcome, string> = {
  answered: 'Picked up', 'no-answer': 'Didn’t pick up', callback: 'Callback scheduled', 'not-interested': 'Not interested',
  'do-not-call': 'Do not call', quote: 'Quote booked', note: 'Note added', reopen: 'Returned to queue', assign: 'Assignment changed',
};
const dateLabel = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' });
const button = 'min-h-12 rounded-xl border border-white/15 px-3 py-2 font-semibold text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-sky-300';
const primary = button.replace('text-white', 'text-navy-900') + ' border-sky-400 bg-sky-500';
type Row = CallingRecord & { pending: boolean; eligible: boolean; attempts: number; review: boolean; reservedBy: StaffProfile | null };
type Snapshot = { rows: Row[]; stats: Record<StaffProfile, { attempted: number; answered: number; quotes: number }>; policy: CallPolicy };
type Mode = 'callback' | 'quote' | null;

function History({ events }: { events: CallEvent[] }) {
  if (!events.length) return <p className="text-sm text-slate-300">No call history yet.</p>;
  return <ol className="divide-y divide-white/10">{events.filter(event => event.outcome !== 'assign').map(event =>
    <li className="py-2" key={event.id}>
      <p className="font-medium text-white">{labels[event.outcome]}</p>
      <p className="text-sm text-slate-300">{STAFF_PROFILES[event.staff]}{event.channel ? " (" + event.channel + ")" : ""} · {dateLabel(event.at)}</p>
      {event.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{event.notes}</p>}
    </li>)}</ol>;
}

export default function CallListPage() {
  const reduceMotion = useReducedMotion();
  const profile = useStaffProfile();
  const router = useRouter();
  const more = useMoreSheet();
  const navigation = adminNavItems();
  const session = useRef('');
  const leadRef = useRef<CallingRecord | null>(null);
  const advancing = useRef(false);
  const skippedIds = useRef(new Set<string>());
  const appointmentForm = useRef<HTMLElement>(null);
  const callActions = useRef<HTMLDivElement>(null);
  const dialedLead = useRef<string | null>(null);
  const returningFromDialer = useRef(false);
  const restoredProfile = useRef<StaffProfile | null>(null);
  const expiry = useRef(0);
  const renewal = useRef<Promise<void> | null>(null);
  const saving = useRef(false);
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [filter, setFilter] = useState<typeof filters[number]>(filters[0]);
  const [search, setSearch] = useState('');
  const [lead, setLead] = useState<CallingRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [answered, setAnswered] = useState(false);
  const [mode, setMode] = useState<Mode>(null);
  const [when, setWhen] = useState('');
  const [service, setService] = useState<keyof typeof serviceOptions>('window-washing');
  const [assignee, setAssignee] = useState<StaffProfile>('liam');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [slots, setSlots] = useState<CallingRecord['booking'][] | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaseValid, setLeaseValid] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rules, setRules] = useState<CallPolicy | null>(null);

  const post = useCallback(async (body: Record<string, unknown>, keepalive = false) => {
    const response = await fetch('/api/admin/calling', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, session: session.current }), keepalive,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not save.');
    return result;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/calling?session=' + encodeURIComponent(session.current), { cache: 'no-store' });
      if (response.status === 401) { router.replace('/admin'); return; }
      if (!response.ok) throw new Error('Could not refresh Call List.');
      setSnapshot(await response.json());
    } catch { setError(previous => previous || 'Could not refresh Call List. Check your connection.'); }
  }, [router]);

  useEffect(() => {
    session.current ||= crypto.randomUUID();
    void refresh();
    const maintain = async () => {
      if (document.hidden) return;
      const active = leadRef.current;
      if (active && !saving.current && !advancing.current) {
        if (expiry.current <= Date.now()) setLeaseValid(false);
        if (renewal.current) return;
        renewal.current = post({ action: 'reserve', bookingId: active.booking.id }).then(result => {
          expiry.current = result.expires ?? 0;
          setLeaseValid(expiry.current > Date.now());
        }).catch(() => setLeaseValid(false)).finally(() => { renewal.current = null; });
      } else if (!active) void refresh();
    };
    const timer = window.setInterval(() => void maintain(), 25000);
    const release = () => {
      const active = leadRef.current;
      if (active && dialedLead.current !== active.booking.id) {
        void post({ action: 'release', bookingId: active.booking.id }, true).catch(() => {});
      }
    };
    const resume = () => {
      if (document.hidden) return;
      void maintain();
      if (returningFromDialer.current) {
        returningFromDialer.current = false;
        callActions.current?.scrollIntoView({ block: 'end' });
      }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pagehide', release);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [post, refresh]);

  const day = when.slice(0, 10);
  useEffect(() => {
    if (mode) appointmentForm.current?.scrollIntoView({ block: 'start' });
  }, [mode]);

  useEffect(() => {
    if (lead && returningFromDialer.current && callActions.current && !document.hidden) {
      returningFromDialer.current = false;
      callActions.current.scrollIntoView({ block: 'end' });
    }
  }, [lead]);

  useEffect(() => {
    if (mode !== 'quote' || !day) return;
    const controller = new AbortController();
    setSlots(null);
    setAvailabilityError(false);
    const nextDay = new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10);
    const start = sydneyLocalToIso(day + 'T00:00');
    const end = sydneyLocalToIso(nextDay + 'T00:00');
    if (!start || !end) return;
    const query = new URLSearchParams({ start, end });
    fetch('/api/admin/calendar?' + query, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) setSlots(result.bookings);
      }).catch(() => { if (!controller.signal.aborted) setAvailabilityError(true); });
    return () => controller.abort();
  }, [mode, day]);

  const resumeKey = profile ? 'gb-crm:call-return:' + profile : '';
  const rememberDial = (bookingId: string | null, pickedUp = false) => {
    dialedLead.current = bookingId;
    if (!resumeKey) return;
    try {
      if (bookingId) sessionStorage.setItem(resumeKey, JSON.stringify({ bookingId, session: session.current, pickedUp }));
      else sessionStorage.removeItem(resumeKey);
    } catch { /* Storage can be disabled. */ }
  };
  const markDialed = () => {
    if (!lead) return;
    rememberDial(lead.booking.id, answered);
    returningFromDialer.current = true;
  };

  const setActive = (active: CallingRecord | null, pickedUp = false) => {
    if (dialedLead.current && dialedLead.current !== active?.booking.id) rememberDial(null);
    advancing.current = false;
    leadRef.current = active;
    setLead(active);
    setNotes(active ? readStaffPreference(profile, 'call-draft:' + active.booking.id) ?? '' : '');
    setAnswered(pickedUp);
    setMode(null);
    setWhen('');
    setAppointmentNotes('');
    setLeaseValid(true);
    setAssignee(profile ?? 'liam');
    const initial = active?.booking.service.split(',')[0];
    setService(initial && initial in serviceOptions ? initial as keyof typeof serviceOptions : 'window-washing');
  };

  const next = async (bookingId?: string) => {
    const result = await post({ action: 'reserve', bookingId, excludedIds: [...skippedIds.current] });
    expiry.current = result.expires ?? 0;
    setActive(result.lead);
    if (!result.lead) setNotice(skippedIds.current.size ? 'No more leads in this pass. Start Calling again to revisit skipped leads.' : 'No calls are ready right now.');
  };
  const advance = async () => {
    advancing.current = true;
    setLeaseValid(false);
    await next();
    void refresh();
  };
  const perform = async (work: () => Promise<void>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await renewal.current; await work(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const record = async (input: Omit<OutcomeInput, 'requestId'>) => {
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
    const result = await post({ action: 'outcome', input: { ...input, requestId: retry.current.id } });
    retry.current = null;
    return result.event as CallEvent;
  };
  const saveOutcome = (outcome: CallOutcome) => perform(async () => {
    if (!lead) return;
    const timed = outcome === 'callback' || outcome === 'quote';
    const nextAt = timed ? sydneyLocalToIso(when) : undefined;
    if (timed && !nextAt) throw new Error('Choose a valid Canberra date and time.');
    const event = await record({
      bookingId: lead.booking.id, outcome, notes,
      recordAttempt: outcome === 'quote' ? false : undefined,
      nextAt: nextAt ?? undefined,
      service: outcome === 'quote' ? service : undefined,
      assigned: outcome === 'quote' ? assignee : undefined,
      appointmentNotes: outcome === 'quote' ? appointmentNotes : undefined,
    });
    writeStaffPreference(profile, 'call-draft:' + lead.booking.id, null);
    setNotes('');
    setNotice(labels[outcome] + '.');
    if (outcome === 'note' || outcome === 'answered') {
      const active = { ...lead, state: { ...lead.state, events: [...lead.state.events, event] } };
      leadRef.current = active;
      setLead(active);
      if (outcome === 'answered') {
        setAnswered(true);
        if (dialedLead.current === lead.booking.id) rememberDial(lead.booking.id, true);
      }
    } else {
      rememberDial(null);
      await advance();
    }
    void refresh();
  });
  const exit = () => perform(async () => {
    if (lead) {
      const id = lead.booking.id;
      setActive(null);
      await post({ action: 'release', bookingId: id });
    }
    await refresh();
  });

  useEffect(() => {
    if (!profile || restoredProfile.current === profile) return;
    restoredProfile.current = profile;
    try {
      const raw = sessionStorage.getItem(resumeKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.bookingId !== 'string' || typeof saved.session !== 'string') return;
      session.current = saved.session;
      void perform(async () => {
        try {
          const result = await post({ action: 'reserve', bookingId: saved.bookingId });
          expiry.current = result.expires ?? 0;
          rememberDial(saved.bookingId, saved.pickedUp === true);
          returningFromDialer.current = true;
          setActive(result.lead, saved.pickedUp === true);
        } catch (error) {
          rememberDial(null);
          throw error;
        }
      });
    } catch { /* There is no saved call to restore. */ }
  }, [profile, resumeKey]);

  const rows = (snapshot?.rows ?? []).filter(row => {
    const query = search.toLowerCase().trim();
    if (query && ![row.booking.name, row.booking.address, row.booking.suburb, row.booking.phone].join(' ').toLowerCase().includes(query) &&
      !(query.match(/\d/) && row.booking.phone.replace(/\D/g, '').includes(query.replace(/\D/g, '')))) return false;
    switch (filter) {
      case 'Never contacted': return row.pending && !row.attempts;
      case 'No answer / callback required': return row.pending && !!row.state.nextAt && !row.review;
      case 'Contacted': return row.booking.status === 'contacted' && !row.state.disposition;
      case 'Quote booked': return row.booking.status === 'quote-booked';
      case 'Review': return row.review;
      case 'Excluded': return !!row.state.disposition;
      default: return row.pending && !row.review;
    }
  });
  const totals = Object.values(snapshot?.stats ?? {}).reduce((sum, row) => ({
    attempted: sum.attempted + row.attempted, answered: sum.answered + row.answered, quotes: sum.quotes + row.quotes,
  }), { attempted: 0, answered: 0, quotes: 0 });

  return <div className="relative isolate flex min-h-[100svh] bg-navy-900">
    {lead && <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-navy-900" />}
    {!lead && <AdminSidebar active="calling" items={navigation} />}
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-5 px-4 pb-28" style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
      <header className="crm-topbar flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{lead ? 'Calling mode' : 'Call List'}</h1>
        {lead ? <button className={button} onClick={exit} disabled={busy}>Exit</button> :
          <button className={button} onClick={() => void refresh()}>Refresh</button>}
      </header>
      {error && <p role="alert" className="rounded-xl bg-red-950 p-3 text-red-100">{error}</p>}
      {notice && <p role="status" className="text-sky-200">{notice}</p>}
      {lead ? <>
        {advancing.current && (busy ? <p role="status" className="text-sky-200">Loading next lead…</p> :
          <button className={button} onClick={() => perform(advance)}>Retry next lead</button>)}
        {!leaseValid && !advancing.current && <div className="rounded-xl border border-amber-400/40 p-3 text-amber-200">Reservation could not be refreshed. <button className={button} onClick={() => perform(async () => {
          const result = await post({ action: 'reserve', bookingId: lead.booking.id });
          expiry.current = result.expires ?? 0;
          setLeaseValid(expiry.current > Date.now());
        })}>Retry reservation</button></div>}
        <div className="bg-navy-900">
        <AnimatePresence initial={false} mode="wait">
          <motion.div key={lead.booking.id} className="space-y-5"
            initial={{ opacity: reduceMotion ? 1 : 0 }}
            animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : 0.12, ease: 'easeOut' } }}
            exit={{ opacity: reduceMotion ? 1 : 0, pointerEvents: 'none', transition: { duration: reduceMotion ? 0 : 0.08, ease: 'easeIn' } }}>
        <section className="space-y-2">
          <h2 className="break-words text-3xl font-bold text-white">{lead.booking.name}</h2>
          <a className={'block min-h-11 text-2xl font-semibold text-sky-300' + (!leaseValid ? ' pointer-events-none' : '')} onClick={markDialed} href={leaseValid ? 'tel:' + lead.booking.phone.replace(/[^+0-9]/g, '') : undefined}>{lead.booking.phone}</a>
          <p className="break-words">{[lead.booking.address, lead.booking.suburb].filter(Boolean).join(', ')}</p>
          <p className="text-sm text-slate-300">{lead.booking.attributionSource || lead.booking.source} · {lead.state.events.filter(event => event.attempt !== null).length} attempts</p>
          {lead.booking.email && <p className="break-all text-sm text-slate-300">{lead.booking.email}</p>}
          {lead.booking.notes && <p className="whitespace-pre-wrap break-words border-l-2 border-sky-400 pl-3">{lead.booking.notes}</p>}
          {lead.booking.adminNotes && <details><summary className="min-h-11 cursor-pointer py-2">Existing CRM notes</summary><p className="whitespace-pre-wrap break-words">{lead.booking.adminNotes}</p></details>}
        </section>
        <label className="block space-y-2 font-semibold">Quick notes
          <textarea className="form-input min-h-28 text-base" rows={3} value={notes} maxLength={8000} onChange={event => {
            setNotes(event.target.value);
            writeStaffPreference(profile, 'call-draft:' + lead.booking.id, event.target.value);
          }} />
        </label>
        <button className={button} disabled={!notes.trim() || busy || !leaseValid} onClick={() => void saveOutcome('note')}>Save note</button>
        <details>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Call history ({lead.state.events.length})</summary>
          <History events={lead.state.events} />
        </details>
        {mode && <section ref={appointmentForm} className="crm-panel scroll-mt-4 space-y-3 p-4" aria-label={mode === 'quote' ? 'Book quote' : 'Schedule callback'}>
          <h2 className="font-semibold text-white">{mode === 'quote' ? 'Book quote' : 'Schedule callback'}</h2>
          <label className="block">Date and time (Canberra)
            <input type="datetime-local" className="form-input min-h-12 min-w-0 text-base" value={when} onChange={event => setWhen(event.target.value)} />
          </label>
          {mode === 'quote' && <>
            <label className="block">Service<select className="form-input min-h-12 text-base" value={service} onChange={event => setService(event.target.value as typeof service)}>
              {Object.entries(serviceOptions).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label className="block">Assign appointment to<select className="form-input min-h-12 text-base" value={assignee} onChange={event => setAssignee(event.target.value as StaffProfile)}>
              {Object.entries(STAFF_PROFILES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select></label>
            <label className="block">Appointment notes<textarea className="form-input text-base" value={appointmentNotes} maxLength={4000} onChange={event => setAppointmentNotes(event.target.value)} /></label>
            {day && <div className="text-sm text-slate-300"><h3 className="font-semibold text-white">Calendar that day</h3>
              {availabilityError ? 'Could not load availability.' : !slots ? 'Checking…' : slots.filter(slot => slot.scheduledAt && (!slot.quoteStaff || slot.quoteStaff === assignee)).map(slot =>
                <p key={slot.id}>{dateLabel(slot.scheduledAt!)} · {slot.name}</p>)}
              {slots && !slots.some(slot => slot.scheduledAt && (!slot.quoteStaff || slot.quoteStaff === assignee)) && 'No appointments listed for this assignee.'}
            </div>}
          </>}
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            <button className={primary} onClick={() => void saveOutcome(mode)} disabled={busy || !when || !leaseValid}>{mode === 'quote' ? 'Add to Calendar' : 'Save callback'}</button>
          </div>
        </section>}
          </motion.div>
        </AnimatePresence>
        </div>
        {!mode && <div ref={callActions} className="crm-action-dock sticky bottom-0 z-20 space-y-2 border-t border-white/15 bg-navy-900 pt-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <div className="grid grid-cols-2 gap-2">
            {!answered && <a className={primary + ' flex items-center justify-center gap-2' + (!leaseValid ? ' pointer-events-none opacity-40' : '')} onClick={markDialed} href={leaseValid ? 'tel:' + lead.booking.phone.replace(/[^+0-9]/g, '') : undefined}><PhoneCall size={17} /> Call now</a>}
            <button className={(answered ? primary + ' col-span-2' : button)} disabled={busy || !leaseValid} onClick={() => setMode('quote')}>Book quote</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {answered ? (
              <button className={button + ' col-span-2'} disabled={busy || advancing.current} onClick={() => perform(async () => {
                await post({ action: 'release', bookingId: lead.booking.id });
                rememberDial(null);
                await advance();
              })}>Next lead</button>
            ) : <>
              <button className={button + ' bg-emerald-800'} disabled={busy || !leaseValid} onClick={() => void saveOutcome('answered')}>Picked Up</button>
              <button className={button + ' bg-amber-900'} disabled={busy || !leaseValid} onClick={() => void saveOutcome('no-answer')}>Didn’t Pick Up</button>
            </>}
          </div>
          <div className="flex items-start justify-between gap-3">
          <details key={lead.booking.id} className="min-w-0 flex-1 text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-slate-300">More call actions</summary>
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={busy || !leaseValid} onClick={() => setMode('callback')}>Call Back Later</button>
              <button className={button + ' bg-red-950'} disabled={busy || !leaseValid} onClick={() => void saveOutcome('not-interested')}>Not Interested</button>
              <button className="min-h-11 text-left text-sm font-medium text-red-300" disabled={busy || !leaseValid} onClick={() => {
                if (confirm('Permanently exclude this lead from calls until reopened?')) void saveOutcome('do-not-call');
              }}>Do not call</button>
            </div>
          </details>
            {!answered && <button className={button} disabled={busy || advancing.current} onClick={() => perform(async () => {
              await post({ action: 'release', bookingId: lead.booking.id });
              skippedIds.current.add(lead.booking.id);
              rememberDial(null);
              await advance();
            })}>Skip</button>}
          </div>
        </div>}
      </> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries({ 'Leads remaining': snapshot?.rows.filter(row => row.pending && !row.review).length, 'Calls attempted today': totals.attempted, 'Calls answered today': totals.answered, 'Quotes booked today': totals.quotes }).map(([label, value]) =>
            <div key={label} className="crm-kpi"><strong className="block text-xl text-white">{snapshot ? value : '–'}</strong><span className="text-sm text-slate-300">{label}</span></div>)}
        </div>
        <button className={primary + ' w-full'} disabled={busy || !snapshot} onClick={() => perform(async () => {
          skippedIds.current.clear();
          await next();
        })}>Start Calling</button>
        <div className="grid gap-3 sm:grid-cols-2">
          <input aria-label="Search leads" placeholder="Search name, phone or address" className="form-input min-h-12 text-base" value={search} onChange={event => setSearch(event.target.value)} />
          <select aria-label="Filter leads" className="form-input min-h-12 text-base" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
            {filters.map(item => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="crm-panel">
          {snapshot && !rows.length && <p className="p-4 text-slate-300">No leads match this view.</p>}
          {rows.map(row => {
            const lastAttempt = row.state.events.findLast(event => event.attempt !== null)?.at ?? row.booking.contactedAt;
            return <article key={row.booking.id} className="crm-queue-row space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <h2 className="break-words font-semibold text-white">{row.booking.name}</h2>
                <p className="break-words text-sm">{row.booking.phone} · {row.booking.suburb || row.booking.address}</p>
                <p className="text-sm text-slate-300">{row.booking.attributionSource || row.booking.source} · {row.booking.status.replaceAll('-', ' ')} · {row.attempts} attempts</p>
                {lastAttempt && <p className="text-sm text-slate-300">Last contact or attempt {dateLabel(lastAttempt)}</p>}
                {row.state.nextAt && !row.review && <p className="text-sm text-amber-200">Next call {dateLabel(row.state.nextAt)}</p>}
                {row.reservedBy && <p className="text-sm text-amber-200">In use by {STAFF_PROFILES[row.reservedBy]}</p>}
                {row.state.disposition && <p className="text-sm text-red-300">{labels[row.state.disposition]}</p>}
              </div>
              {row.eligible && <button className={button} disabled={busy} onClick={() => perform(() => next(row.booking.id))}>Open</button>}
            </div>
            {row.booking.notes && <p className="line-clamp-2 break-words text-sm text-slate-300">{row.booking.notes}</p>}
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm">History and assignment</summary>
              {row.booking.adminNotes && <p className="whitespace-pre-wrap break-words text-sm">{row.booking.adminNotes}</p>}
              <History events={row.state.events} />
              <label className="block text-sm">Assign calls<select aria-label={'Assign ' + row.booking.name} className="form-input min-h-11 text-base" value={row.state.assigned ?? ''} disabled={busy || !!row.reservedBy}
                onChange={event => { const assigned = (event.target.value || null) as StaffProfile | null; void perform(async () => { await record({ bookingId: row.booking.id, outcome: 'assign', assigned }); await refresh(); }); }}>
                <option value="">Either caller</option>{Object.entries(STAFF_PROFILES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select></label>
              {(row.review || row.state.disposition) && <button className={button + ' mt-2'} disabled={busy || !!row.reservedBy} onClick={() => {
                if (confirm('Return this lead to the calling queue?')) void perform(async () => { await record({ bookingId: row.booking.id, outcome: 'reopen' }); await refresh(); });
              }}>Return to queue</button>}
            </details>
          </article>;
          })}
        </div>
        {snapshot && <details onToggle={event => { if (event.currentTarget.open) setRules(snapshot.policy); }}>
          <summary className="min-h-12 cursor-pointer py-3 font-semibold">Queue settings</summary>
          {rules && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(async () => { await post({ action: 'policy', input: rules }); setNotice('Queue settings saved.'); await refresh(); }); }}>
            <label className="block">Retry delay (hours)<input type="number" min={1} max={720} value={rules.retryHours} className="form-input text-base" onChange={event => setRules({ ...rules, retryHours: Number(event.target.value) })} /></label>
            <label className="block">Unanswered attempts before review<input type="number" min={1} max={20} value={rules.maxAttempts} className="form-input text-base" onChange={event => setRules({ ...rules, maxAttempts: Number(event.target.value) })} /></label>
            <label className="block">Lead priority<select value={rules.priority} className="form-input text-base" onChange={event => setRules({ ...rules, priority: event.target.value as CallPolicy['priority'] })}><option value="new-first">Never contacted first</option><option value="oldest-first">Oldest pending lead first</option></select></label>
            <button className={primary} disabled={busy}>Save settings</button>
          </form>}
        </details>}
      </>}
    </main>
    {!lead && <><AdminMobileNav active="calling" items={navigation} onMore={more.show} /><AdminMoreSheet open={more.open} onClose={more.hide} active="calling" items={navigation} /></>}
  </div>;
}
