'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF_PROFILES } from '@/lib/staff';
import { readStaffPreference, writeStaffPreference, useStaffProfile } from '@/components/admin/StaffSession';
import toast from 'react-hot-toast';
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Calendar as CalIcon, Clock,
} from 'lucide-react';
import type { Booking, BookingStatus } from '@/lib/db';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import { AddressLink } from '@/components/AddressLink';
import ScheduleBookingSheet from '@/components/admin/ScheduleBookingSheet';

type View = 'agenda' | 'day' | 'week' | 'month';

const STATUS_LABEL: Record<BookingStatus, string> = {
  uncontacted: 'Uncontacted', contacted: 'Contacted', 'quote-booked': 'Quote Booked', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead',
};
const STATUS_KEYS: BookingStatus[] = ['uncontacted', 'contacted', 'quote-booked', 'quoted', 'confirmed', 'completed', 'cancelled'];

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing', 'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair', 'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure', 'other': 'Other',
};
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';

// ─── date helpers (Monday-first weeks, local time) ──────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Visible [start, end) range for the current view/anchor.
function rangeFor(view: View, anchor: Date): { start: Date; end: Date } {
  if (view === 'agenda') return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 7) };
  if (view === 'day') return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) };
  if (view === 'week') { const s = mondayOf(anchor); return { start: s, end: addDays(s, 7) }; }
  // month grid: 6 weeks from the Monday on/before the 1st
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const s = mondayOf(first);
  return { start: s, end: addDays(s, 42) };
}

export default function CalendarPage() {
  const router = useRouter();
  const profile = useStaffProfile();
  const [view, setView] = useState<View>('agenda');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
  const [initialized, setInitialized] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<Booking | null>(null);
  const [addFor, setAddFor] = useState<Date | null>(null);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  // Scheduling an existing booking: arrived from a booking page via
  // ?schedule=<bookingId>. Picking a day then fills that booking's calendar slot
  // instead of creating a new job, so the two stay one record.
  const [scheduleFor, setScheduleFor] = useState<Booking | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') ?? readStaffPreference(profile, 'calendar-view');
    if (view === 'agenda' || view === 'day' || view === 'week' || view === 'month') setView(view);
    else if (window.matchMedia('(min-width: 1024px)').matches) setView('month');
    const date = new Date(params.get('date') ?? readStaffPreference(profile, 'calendar-date') ?? '');
    if (!Number.isNaN(date.getTime())) setAnchor(startOfDay(date));
    setInitialized(true);
    const id = params.get('schedule');
    if (id) setView('month');
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${id}`);
        if (res.ok) setScheduleFor(await res.json());
      } catch { /* fall back to normal add */ }
    })();
  }, [profile]);
  useEffect(() => {
    if (!initialized || new URLSearchParams(window.location.search).has("schedule")) return;
    writeStaffPreference(profile, "calendar-view", view);
    writeStaffPreference(profile, "calendar-date", sameDay(anchor, new Date()) ? null : anchor.toISOString());
  }, [initialized, profile, view, anchor]);

  const cancelScheduling = () => {
    setScheduleFor(null);
    window.history.replaceState({}, '', '/admin/calendar');
  };

  const { start, end } = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const [calendarError, setCalendarError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setCalendarError(false);
    try {
      const res = await fetch(`/api/admin/calendar?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
    } catch { setCalendarError(true); }
    finally { setLoading(false); }
  }, [start, end, router]);

  useEffect(() => { if (initialized) void load(); }, [initialized, load]);

  const agendaHasItems = bookings.some(b => b.scheduledAt && !["cancelled", "cold"].includes(b.status));
  const byDay = useCallback(
    (d: Date) => bookings
      .filter(b => b.scheduledAt && sameDay(new Date(b.scheduledAt), d))
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [bookings],
  );

  const step = (dir: number) => {
    if (view === 'day') setAnchor(a => addDays(a, dir));
    else if (view === 'week' || view === 'agenda') setAnchor(a => addDays(a, dir * 7));
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  };

  const title = view === 'agenda'
    ? anchor.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'day'
    ? anchor.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${mondayOf(anchor).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${addDays(mondayOf(anchor), 6).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : anchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const openDay = (date: Date) => {
    setAnchor(date);
    setView('day');
  };
  const openBooking = (booking: Booking) => {
    const from = "/admin/calendar?" + new URLSearchParams({ view, date: anchor.toISOString() });
    router.push("/admin/bookings/" + booking.id + "?from=" + encodeURIComponent(from));
  };

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="calendar" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
      <header
        className="crm-topbar sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between gap-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <h1 className="flex items-center gap-2 font-bold text-white"><CalIcon className="size-5 text-sky-400" /> Calendar</h1>
        <button onClick={() => setAddFor(view === 'day' ? anchor : startOfDay(new Date()))} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
          <Plus className="size-4" /> Add appointment
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 pb-28">
        {/* Scheduling an existing booking */}
        {scheduleFor && (
          <div className="mb-4 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sky-200 text-sm font-semibold truncate">
                Scheduling: {scheduleFor.name}
              </div>
              <div className="text-slate-400 text-xs truncate">
                Open a day, then tap Add on this day to set the time.
              </div>
            </div>
            <button onClick={cancelScheduling} className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-white/15 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer">Cancel</button>
          </div>
        )}

        {/* Controls */}
        <div className="crm-panel mb-5 flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} aria-label="Previous period" className="h-11 w-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setAnchor(startOfDay(new Date()))} className="h-11 px-4 rounded-lg border border-white/10 text-slate-300 hover:text-white text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60">Today</button>
            <button onClick={() => step(1)} aria-label="Next period" className="h-11 w-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="order-first w-full text-left text-sm font-semibold text-white sm:order-none sm:w-auto sm:flex-1 sm:text-center sm:text-base">{title}</div>
          <div className="flex w-full items-center justify-between gap-1 rounded-lg border border-white/10 p-0.5 sm:w-auto" role="group" aria-label="Calendar view">
            {(['agenda', 'day', 'week', 'month'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`min-h-11 px-2.5 py-2 rounded-md text-xs font-semibold capitalize cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${view === v ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>{v}</button>
            ))}
          </div>
        </div>

        {calendarError && <p role="alert" className="mb-4 text-red-300">Could not load the calendar. <button type="button" onClick={() => void load()} className="min-h-11 underline">Retry</button></p>}
        {loading && <div className="text-slate-500 text-sm text-center py-10">Loading…</div>}


        {!loading && !calendarError && view === 'agenda' && (
          <div className="space-y-5">
            {Array.from({ length: 7 }, (_, offset) => addDays(anchor, offset)).map(day => {
              const items = byDay(day).filter(b => !["cancelled", "cold"].includes(b.status));
              const today = startOfDay(new Date());
              if (!items.length && !sameDay(day, today) && !sameDay(day, addDays(today, 1))) return null;
              const label = sameDay(day, today) ? 'Today' : sameDay(day, addDays(today, 1)) ? 'Tomorrow' :
                day.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
              return (
                <section key={day.toISOString()} className="space-y-2">
                  <h2 className="font-semibold text-white">{label}</h2>
                  {items.length ? items.map(booking => (
                    <div key={booking.id} className="crm-panel flex flex-wrap items-center gap-2 p-3">
                      <button onClick={() => openBooking(booking)} className="min-h-11 min-w-0 flex-1 text-left">
                        <span className="block text-sm text-sky-300">{timeLabel(booking.scheduledAt!)} · {['uncontacted', 'contacted', 'quote-booked'].includes(booking.status) ? 'Quote visit' : 'Job'}</span>
                        <span className="block font-semibold text-white">{booking.name}</span>
                        <span className="block text-sm text-slate-300">{[booking.suburb, booking.quoteStaff ? STAFF_PROFILES[booking.quoteStaff] : null].filter(Boolean).join(" / ")}</span>
                      </button>
                      <button onClick={() => setEdit(booking)} className="min-h-11 rounded-lg border border-white/10 px-3 text-sm text-sky-300">Reschedule</button>
                    </div>
                  )) : <p className="text-sm text-slate-300">No appointments.</p>}
                </section>
              );
            })}
            {!agendaHasItems && !sameDay(anchor, startOfDay(new Date())) && <p className="text-slate-300">No appointments in this period.</p>}
          </div>
        )}

        {!loading && !calendarError && view === 'month' && (
          <MonthGrid anchor={anchor} byDay={byDay} onOpen={openBooking} onDay={openDay} />
        )}
        {!loading && !calendarError && view === 'week' && (
          <WeekView anchor={anchor} byDay={byDay} onOpen={openBooking} onAdd={setAddFor} onDay={openDay} />
        )}
        {!loading && !calendarError && view === 'day' && (
          <DayView day={anchor} items={byDay(anchor)} onOpen={openBooking} onAdd={() => setAddFor(anchor)} />
        )}
      </main>

      {edit && (
        <ScheduleBookingSheet booking={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); load(); }} />
      )}
      {addFor && (
        <AddModal
          day={addFor}
          booking={scheduleFor}
          onClose={() => setAddFor(null)}
          onCreated={() => {
            setAddFor(null);
            if (scheduleFor) cancelScheduling();
            load();
          }}
        />
      )}
      </div>
      <AdminMobileNav active="calendar" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="calendar" items={navItems} />
    </div>
  );
}

// ─── Booking chip ───────────────────────────────────────────────────────────
function Chip({ b, onClick }: { b: Booking; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-1.5 py-1 rounded text-[11px] leading-tight truncate cursor-pointer badge-${b.status} hover:opacity-90`}>
      {b.scheduledAt && <span className="font-semibold">{timeLabel(b.scheduledAt)} </span>}{b.name}
    </button>
  );
}

// ─── Month ──────────────────────────────────────────────────────────────────
function MonthGrid({ anchor, byDay, onOpen, onDay }: {
  anchor: Date; byDay: (d: Date) => Booking[]; onOpen: (b: Booking) => void; onDay: (d: Date) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = mondayOf(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className="grid grid-cols-7 bg-white/5 text-slate-400 text-[11px] font-semibold">
        {DOW.map(d => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const items = byDay(d);
          return (
            <div key={i} className={`min-h-[92px] border-t border-l border-white/5 p-1 ${i % 7 === 6 ? '' : ''} ${inMonth ? '' : 'bg-white/[0.015]'}`}>
              <div className="flex items-center justify-between mb-1">
                <button
                  onClick={() => onDay(d)}
                  aria-label={`View ${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  className={`min-h-11 w-full rounded-lg text-xs font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${sameDay(d, today) ? 'bg-sky-500 text-white' : inMonth ? 'text-slate-300 hover:bg-white/10' : 'text-slate-500 hover:bg-white/10'}`}
                >
                  {d.getDate()}
                </button>
              </div>
              <div className="space-y-1">
                {items.slice(0, 3).map(b => <Chip key={b.id} b={b} onClick={() => onOpen(b)} />)}
                {items.length > 3 && <div className="text-[10px] text-slate-500 pl-1">+{items.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Week ───────────────────────────────────────────────────────────────────
function WeekView({ anchor, byDay, onOpen, onAdd, onDay }: {
  anchor: Date; byDay: (d: Date) => Booking[]; onOpen: (b: Booking) => void; onAdd: (d: Date) => void; onDay: (d: Date) => void;
}) {
  const start = mondayOf(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((d, i) => {
        const items = byDay(d);
        return (
          <div key={i} className="rounded-xl border border-white/10 bg-navy-800 p-2 min-h-[120px]">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => onDay(d)} className={`min-h-11 flex-1 text-left text-xs font-semibold ${sameDay(d, today) ? 'text-sky-400' : 'text-slate-300'}`}>
                {DOW[i]} {d.getDate()}
              </button>
              <button onClick={() => onAdd(d)} aria-label="Add booking on this day" className="grid min-h-11 min-w-11 place-items-center text-slate-400 hover:text-sky-400 cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <div className="space-y-1">
              {items.length === 0 && <div className="text-[11px] text-slate-600">-</div>}
              {items.map(b => <Chip key={b.id} b={b} onClick={() => onOpen(b)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Day ────────────────────────────────────────────────────────────────────
function DayView({ day, items, onOpen, onAdd }: {
  day: Date; items: Booking[]; onOpen: (b: Booking) => void; onAdd: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-navy-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-white font-semibold">{items.length} job{items.length !== 1 ? 's' : ''}</div>
        <button onClick={onAdd} className="inline-flex min-h-11 items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-sm font-semibold cursor-pointer"><Plus className="w-4 h-4" /> Add on this day</button>
      </div>
      {items.length === 0 ? (
        <div className="text-slate-500 text-sm py-8 text-center">Nothing scheduled for {day.toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}.</div>
      ) : (
        <div className="space-y-2">
          {items.map(b => (
            <button key={b.id} onClick={() => onOpen(b)} className="w-full flex items-center gap-3 p-3 rounded-lg border border-white/10 hover:border-sky-400/30 hover:bg-white/[0.03] text-left cursor-pointer">
              <div className="text-sky-300 text-sm font-semibold w-20 flex-shrink-0 inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {b.scheduledAt ? timeLabel(b.scheduledAt) : ''}</div>
              <div className="min-w-0 flex-1">
                <div className="text-white text-sm font-medium truncate">{b.name}</div>
                <div className="text-slate-500 text-xs truncate">{serviceText(b.service)}{(b.address || b.suburb) ? ` · ${[b.address, b.suburb].filter(Boolean).join(', ')}` : ''}</div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded font-semibold badge-${b.status}`}>{STATUS_LABEL[b.status]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Edit / reschedule modal ────────────────────────────────────────────────
// ─── Add / schedule modal ───────────────────────────────────────────────────
// Two modes:
//  • `booking` given (arrived from a booking page): the fields are pre-filled
//    from that job and saving PATCHes ITS scheduledAt — one record, so the
//    booking page and the calendar entry are the same thing.
//  • no `booking`: creates a brand-new scheduled job.
function AddModal({ day, booking, onClose, onCreated }: {
  day: Date; booking?: Booking | null; onClose: () => void; onCreated: () => void;
}) {
  const defaultWhen = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T09:00`;
  const [f, setF] = useState({
    name: booking?.name ?? '',
    phone: booking?.phone ?? '',
    address: booking?.address ?? '',
    suburb: booking?.suburb ?? '',
    service: booking?.service || 'window-washing',
    when: defaultWhen,
  });
  // Two kinds of calendar slot: an on-site quote visit (no price given yet —
  // status becomes "quote-booked") or the confirmed cleaning job (status
  // "confirmed"). Existing booking still early (uncontacted/contacted/
  // quote-booked) defaults to Quote visit; anything past that (already
  // quoted/confirmed/etc) or a brand-new entry defaults to Job, same as
  // this modal always behaved before Quote visit existed.
  const [kind, setKind] = useState<'quote' | 'job'>(() =>
    booking && (booking.status === 'uncontacted' || booking.status === 'contacted' || booking.status === 'quote-booked') ? 'quote' : 'job'
  );
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      if (booking) {
        // Schedule the existing job/quote visit: fills its calendar slot, keeps any edits.
        const status = kind === 'quote'
          ? 'quote-booked'
          : (booking.status === 'uncontacted' || booking.status === 'contacted' || booking.status === 'quote-booked' || booking.status === 'quoted' ? 'confirmed' : booking.status);
        const res = await fetch(`/api/admin/bookings/${booking.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: f.name, phone: f.phone, address: f.address, suburb: f.suburb,
            service: f.service,
            scheduledAt: fromLocalInput(f.when),
            status,
          }),
        });
        if (!res.ok) throw new Error();
        toast.success(`${f.name} added to the calendar`);
      } else {
        const res = await fetch('/api/admin/bookings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: f.name, phone: f.phone, address: f.address, suburb: f.suburb,
            service: f.service, propertyType: 'residential', status: kind === 'quote' ? 'quote-booked' : 'confirmed',
            scheduledAt: fromLocalInput(f.when),
          }),
        });
        if (!res.ok) throw new Error();
        toast.success('Added to calendar');
      }
      onCreated();
    } catch { toast.error('Could not save'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90svh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-navy-800 p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-white font-semibold">{booking ? `Schedule ${booking.name}` : (kind === 'quote' ? 'New quote visit' : 'New scheduled job')}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {booking && (
            <p className="text-sky-300 text-xs bg-sky-400/10 border border-sky-400/25 rounded-lg px-3 py-2">
              Filled in from this booking. Saving links it to this calendar slot.
            </p>
          )}
          <div>
            <label className="block text-slate-400 text-xs mb-1">What is this?</label>
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-white/10 bg-navy-900/60 p-1">
              <button type="button" onClick={() => setKind('quote')} className={`py-2 rounded-md text-sm font-semibold cursor-pointer transition-colors ${kind === 'quote' ? 'bg-orange-400/20 text-orange-300' : 'text-slate-400'}`}>Quote visit</button>
              <button type="button" onClick={() => setKind('job')} className={`py-2 rounded-md text-sm font-semibold cursor-pointer transition-colors ${kind === 'job' ? 'bg-sky-500 text-white' : 'text-slate-400'}`}>Confirmed job</button>
            </div>
            {kind === 'quote' && <p className="text-slate-500 text-xs mt-1">On-site visit to give a quote — no price locked in yet. Status becomes Quote Booked.</p>}
          </div>
          <div><label className="block text-slate-400 text-xs mb-1">Name *</label><input className="form-input text-sm" value={f.name} onChange={e => set('name', e.target.value)} /></div>
          <div><label className="block text-slate-400 text-xs mb-1">Phone</label><input type="tel" className="form-input text-sm" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div><label className="block text-slate-400 text-xs mb-1">Address</label><input className="form-input text-sm" value={f.address} onChange={e => set('address', e.target.value)} /></div>
          <div><label className="block text-slate-400 text-xs mb-1">Suburb</label><input className="form-input text-sm" value={f.suburb} onChange={e => set('suburb', e.target.value)} /></div>
          <div>
            <label className="block text-slate-400 text-xs mb-1">Service</label>
            <select className="form-input text-sm" value={f.service} onChange={e => set('service', e.target.value)}>
              {Object.entries(SERVICE_LABELS).filter(([k]) => k !== 'both').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label className="block text-slate-400 text-xs mb-1">Date &amp; time</label><input type="datetime-local" className="form-input text-sm" value={f.when} onChange={e => set('when', e.target.value)} /></div>
          <button onClick={save} disabled={busy} className="w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold cursor-pointer inline-flex items-center justify-center gap-2">
            {busy ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} {booking ? 'Save to calendar' : 'Add to calendar'}
          </button>
        </div>
      </div>
    </div>
  );
}
