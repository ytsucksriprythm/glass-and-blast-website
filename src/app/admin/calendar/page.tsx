'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ChevronLeft, ChevronRight, Plus, X, Check, Calendar as CalIcon, Clock,
  Trash2, ExternalLink, CalendarOff, ArrowLeft,
} from 'lucide-react';
import type { Booking, BookingStatus } from '@/lib/db';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import { AddressLink } from '@/components/AddressLink';

type View = 'day' | 'week' | 'month';

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead',
};
const STATUS_KEYS: BookingStatus[] = ['pending', 'quoted', 'confirmed', 'completed', 'cancelled'];

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing', 'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair', 'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure', 'other': 'Other',
};
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '—';

// ─── date helpers (Monday-first weeks, local time) ──────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Visible [start, end) range for the current view/anchor.
function rangeFor(view: View, anchor: Date): { start: Date; end: Date } {
  if (view === 'day') return { start: startOfDay(anchor), end: addDays(startOfDay(anchor), 1) };
  if (view === 'week') { const s = mondayOf(anchor); return { start: s, end: addDays(s, 7) }; }
  // month grid: 6 weeks from the Monday on/before the 1st
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const s = mondayOf(first);
  return { start: s, end: addDays(s, 42) };
}

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
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
    const id = new URLSearchParams(window.location.search).get('schedule');
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${id}`);
        if (res.ok) setScheduleFor(await res.json());
      } catch { /* fall back to normal add */ }
    })();
  }, []);
  const cancelScheduling = () => {
    setScheduleFor(null);
    window.history.replaceState({}, '', '/admin/calendar');
  };

  const { start, end } = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/calendar?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
      if (res.status === 401) { router.push('/admin'); return; }
      const data = await res.json();
      setBookings(Array.isArray(data?.bookings) ? data.bookings : []);
    } catch { setBookings([]); }
    finally { setLoading(false); }
  }, [start, end, router]);

  useEffect(() => { load(); }, [load]);

  const byDay = useCallback(
    (d: Date) => bookings
      .filter(b => b.scheduledAt && sameDay(new Date(b.scheduledAt), d))
      .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [bookings],
  );

  const step = (dir: number) => {
    if (view === 'day') setAnchor(a => addDays(a, dir));
    else if (view === 'week') setAnchor(a => addDays(a, dir * 7));
    else setAnchor(a => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  };

  const title = view === 'day'
    ? anchor.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${mondayOf(anchor).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${addDays(mondayOf(anchor), 6).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : anchor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="calendar" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between gap-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <Link href="/admin/dashboard" className="inline-flex items-center gap-2 -ml-2 px-2 py-2 rounded-lg text-slate-300 hover:text-white active:bg-white/10 text-sm cursor-pointer lg:hidden">
          <ArrowLeft className="w-5 h-5" /> Dashboard
        </Link>
        <div className="text-white font-semibold flex items-center gap-2"><CalIcon className="w-5 h-5 text-sky-400" /> Calendar</div>
        <button onClick={() => setAddFor(startOfDay(new Date()))} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
          <Plus className="w-4 h-4" /> Add
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
                Tap a day to set the time. Details are filled in from the booking.
              </div>
            </div>
            <button onClick={cancelScheduling} className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-white/15 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer">Cancel</button>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} aria-label="Previous period" className="h-11 w-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setAnchor(startOfDay(new Date()))} className="h-11 px-4 rounded-lg border border-white/10 text-slate-300 hover:text-white text-sm font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60">Today</button>
            <button onClick={() => step(1)} aria-label="Next period" className="h-11 w-11 flex items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:text-white hover:border-sky-400/40 cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="text-white font-semibold text-sm sm:text-base text-center flex-1 truncate">{title}</div>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5" role="group" aria-label="Calendar view">
            {(['day', 'week', 'month'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-3 py-2 rounded-md text-xs font-semibold capitalize cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${view === v ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>{v}</button>
            ))}
          </div>
        </div>

        {loading && <div className="text-slate-500 text-sm text-center py-10">Loading…</div>}

        {!loading && view === 'month' && (
          <MonthGrid anchor={anchor} byDay={byDay} onOpen={setEdit} onAdd={setAddFor} />
        )}
        {!loading && view === 'week' && (
          <WeekView anchor={anchor} byDay={byDay} onOpen={setEdit} onAdd={setAddFor} />
        )}
        {!loading && view === 'day' && (
          <DayView day={anchor} items={byDay(anchor)} onOpen={setEdit} onAdd={() => setAddFor(anchor)} />
        )}
      </main>

      {edit && (
        <EditModal booking={edit} onClose={() => setEdit(null)} onChanged={() => { setEdit(null); load(); }} />
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
function MonthGrid({ anchor, byDay, onOpen, onAdd }: {
  anchor: Date; byDay: (d: Date) => Booking[]; onOpen: (b: Booking) => void; onAdd: (d: Date) => void;
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
                  onClick={() => onAdd(d)}
                  aria-label={`Add booking on ${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}`}
                  title="Add booking on this day"
                  className={`w-7 h-7 rounded-full text-xs font-semibold cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 ${sameDay(d, today) ? 'bg-sky-500 text-white' : inMonth ? 'text-slate-300 hover:bg-white/10' : 'text-slate-600 hover:bg-white/10'}`}
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
function WeekView({ anchor, byDay, onOpen, onAdd }: {
  anchor: Date; byDay: (d: Date) => Booking[]; onOpen: (b: Booking) => void; onAdd: (d: Date) => void;
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
              <div className={`text-xs font-semibold ${sameDay(d, today) ? 'text-sky-400' : 'text-slate-300'}`}>
                {DOW[i]} {d.getDate()}
              </div>
              <button onClick={() => onAdd(d)} className="text-slate-500 hover:text-sky-400 cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
            </div>
            <div className="space-y-1">
              {items.length === 0 && <div className="text-[11px] text-slate-600">—</div>}
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
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-sm font-semibold cursor-pointer"><Plus className="w-4 h-4" /> Add on this day</button>
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
function EditModal({ booking, onClose, onChanged }: {
  booking: Booking; onClose: () => void; onChanged: () => void;
}) {
  const [when, setWhen] = useState(toLocalInput(booking.scheduledAt ?? null));
  const [status, setStatus] = useState<BookingStatus>(booking.status);
  const [busy, setBusy] = useState(false);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success(msg);
      onChanged();
    } catch { toast.error('Update failed'); setBusy(false); }
  };

  const save = () => patch({ scheduledAt: fromLocalInput(when), status }, 'Rescheduled');
  const removeFromCal = () => patch({ scheduledAt: null }, 'Removed from calendar');
  const del = async () => {
    if (!window.confirm(`Delete booking for ${booking.name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Booking deleted');
      onChanged();
    } catch { toast.error('Delete failed'); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-white font-semibold truncate">{booking.name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="text-slate-400 text-sm">{serviceText(booking.service)}{(booking.address || booking.suburb) ? ` · ${[booking.address, booking.suburb].filter(Boolean).join(', ')}` : ''}</div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">Scheduled date & time</label>
            <input type="datetime-local" className="form-input" value={when} onChange={e => setWhen(e.target.value)} />
          </div>
          <div>
            <label className="block text-slate-400 text-xs font-medium mb-1.5">Status</label>
            <select className="form-input" value={status} onChange={e => setStatus(e.target.value as BookingStatus)}>
              {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !when} className="flex-1 py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold cursor-pointer inline-flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><Check className="w-4 h-4" /> Save</button>
            <Link href={`/admin/bookings/${booking.id}?from=/admin/calendar`} aria-label="Open full booking" title="Open full booking" className="px-4 py-3 rounded-lg border border-white/10 text-slate-300 hover:text-white cursor-pointer inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"><ExternalLink className="w-4 h-4" /></Link>
          </div>
          <div className="flex gap-2 pt-1 border-t border-white/5">
            <button onClick={removeFromCal} disabled={busy} className="flex-1 mt-3 py-2.5 rounded-lg border border-white/10 text-amber-300 hover:border-amber-400/40 text-sm font-semibold cursor-pointer inline-flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"><CalendarOff className="w-4 h-4" /> Remove from calendar</button>
            <button onClick={del} disabled={busy} aria-label="Delete booking" title="Delete booking" className="mt-3 px-4 py-2.5 rounded-lg border border-white/10 text-red-400 hover:border-red-400/40 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    setBusy(true);
    try {
      if (booking) {
        // Schedule the existing job: fills its calendar slot, keeps any edits.
        const res = await fetch(`/api/admin/bookings/${booking.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: f.name, phone: f.phone, address: f.address, suburb: f.suburb,
            service: f.service,
            scheduledAt: fromLocalInput(f.when),
            status: booking.status === 'pending' || booking.status === 'quoted' ? 'confirmed' : booking.status,
          }),
        });
        if (!res.ok) throw new Error();
        toast.success(`${f.name} added to the calendar`);
      } else {
        const res = await fetch('/api/admin/bookings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: f.name, phone: f.phone, address: f.address, suburb: f.suburb,
            service: f.service, propertyType: 'residential', status: 'confirmed',
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
          <h3 className="text-white font-semibold">{booking ? `Schedule ${booking.name}` : 'New scheduled job'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {booking && (
            <p className="text-sky-300 text-xs bg-sky-400/10 border border-sky-400/25 rounded-lg px-3 py-2">
              Filled in from this booking. Saving links it to this calendar slot.
            </p>
          )}
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
