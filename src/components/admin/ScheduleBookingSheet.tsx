'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Booking, BookingStatus } from '@/lib/db';

function localInput(date: Date) {
  const part = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + part(date.getMonth() + 1) + '-' + part(date.getDate()) +
    'T' + part(date.getHours()) + ':' + part(date.getMinutes());
}

const timeLabel = new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit' });

function DayCalendar({ appointments, when, kind, name }: {
  appointments: Booking[]; when: string; kind: 'quote' | 'job'; name: string;
}) {
  const selected = new Date(when);
  if (Number.isNaN(selected.getTime())) return null;
  const slots = new Map<number, { id: string; date: Date; name: string; label: string; style: string }[]>();
  for (const item of appointments) {
    if (!item.scheduledAt) continue;
    const date = new Date(item.scheduledAt);
    if (Number.isNaN(date.getTime())) continue;
    const hour = date.getHours();
    const entries = slots.get(hour) ?? [];
    entries.push({ id: item.id, date, name: item.name, style: 'badge-' + item.status,
      label: ['uncontacted', 'contacted', 'quote-booked'].includes(item.status) ? 'Quote visit' : item.status === 'completed' ? 'Completed job' : 'Job' });
    slots.set(hour, entries);
  }
  const selectedHour = selected.getHours();
  slots.set(selectedHour, [...(slots.get(selectedHour) ?? []), {
    id: 'selected-slot', date: selected, name, label: kind === 'quote' ? 'Proposed quote visit' : 'Proposed job',
    style: 'border-2 border-dashed border-sky-300/70 bg-sky-400/5 text-sky-100',
  }]);
  const first = Math.min(...slots.keys());
  const last = Math.max(...slots.keys());
  return (
    <div aria-label="Day schedule" tabIndex={0} className="max-h-56 overflow-auto rounded-lg border border-white/10 bg-navy-900/50">
      <div className="divide-y divide-white/10">
        {Array.from({ length: last - first + 1 }, (_, index) => {
          const hour = first + index;
          const hourStart = new Date(selected);
          hourStart.setHours(hour, 0, 0, 0);
          const entries = (slots.get(hour) ?? []).sort((a, b) => a.date.getTime() - b.date.getTime());
          return <div key={hour} className="grid min-h-8 grid-cols-[4.5rem_minmax(0,1fr)]">
            <time className="whitespace-nowrap border-r border-white/10 px-2 py-1.5 text-right text-xs tabular-nums text-slate-300">{timeLabel.format(hourStart)}</time>
            <div className="flex flex-wrap gap-1 p-1">
              {entries.map(entry => <div key={entry.id} className={'min-w-[6.75rem] flex-1 basis-[calc(50%_-_0.25rem)] rounded-md px-2 py-1.5 ' + entry.style}>
                <div className="break-words text-xs font-semibold text-white">{entry.name || 'Appointment'}</div>
                <div className="text-xs">{timeLabel.format(entry.date)} · {entry.label}</div>
              </div>)}
            </div>
          </div>;
        })}
      </div>
    </div>
  );
}

export default function ScheduleBookingSheet({ booking, defaultKind, onClose, onChanged }: {
  booking: Booking;
  defaultKind?: 'quote' | 'job';
  onClose: () => void;
  onChanged: (booking: Booking) => void;
}) {
  const title = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [when, setWhen] = useState(() => {
    if (booking.scheduledAt) return localInput(new Date(booking.scheduledAt));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return localInput(tomorrow);
  });
  const [kind, setKind] = useState<'quote' | 'job'>(() =>
    defaultKind ?? (['uncontacted', 'contacted', 'quote-booked'].includes(booking.status) ? 'quote' : 'job'));
  const [appointments, setAppointments] = useState<Booking[] | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const day = when.slice(0, 10);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => { dialog.close(); };
  }, []);

  useEffect(() => {
    setAppointments(null);
    setAvailabilityError(false);
    if (!day) return;
    const start = new Date(day + 'T00:00:00');
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const controller = new AbortController();
    const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    fetch('/api/admin/calendar?' + query, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data: { bookings: Booking[] } = await response.json();
        if (!controller.signal.aborted) setAppointments(data.bookings.filter(item =>
          item.id !== booking.id && !['cancelled', 'cold'].includes(item.status)));
      })
      .catch(() => { if (!controller.signal.aborted) setAvailabilityError(true); });
    return () => controller.abort();
  }, [booking.id, day]);

  const save = async (unschedule = false) => {
    const date = new Date(when);
    if (busy || (!unschedule && Number.isNaN(date.getTime()))) return;
    setBusy(true);
    setError('');
    try {
      const status: BookingStatus = booking.status === 'completed' ? 'completed' :
        kind === 'quote' ? 'quote-booked' : 'confirmed';
      const response = await fetch('/api/admin/bookings/' + booking.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(unschedule
          ? { scheduledAt: null, ...(booking.status === 'quote-booked' ? { status: 'contacted' } : {}) }
          : { scheduledAt: date.toISOString(), status }),
      });
      if (!response.ok) throw new Error();
      onChanged(await response.json());
    } catch {
      setError('Could not update the schedule. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby={title} onCancel={event => {
      event.preventDefault();
      if (!busy) onClose();
    }} className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none rounded-t-2xl border border-white/10 bg-navy-800 p-0 text-slate-100 backdrop:bg-black/60 sm:inset-0 sm:m-auto sm:max-w-md sm:rounded-2xl">
      <section className="flex max-h-[90dvh] flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <h2 id={title} className="font-semibold text-white">{booking.scheduledAt ? 'Reschedule' : 'Schedule'} {booking.name}</h2>
          <button type="button" onClick={onClose} disabled={busy} className="min-h-11 px-3 text-slate-200">Close</button>
        </header>
        <div className="space-y-4 overflow-y-auto p-4">
          <label className="block space-y-1">
            <span>Appointment type</span>
            <select value={kind} onChange={event => setKind(event.target.value as 'quote' | 'job')} className="form-input text-base" disabled={booking.status === 'completed'}>
              <option value="quote">Quote visit</option>
              <option value="job">Job</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span>Date and time</span>
            <input type="datetime-local" value={when} onChange={event => setWhen(event.target.value)}
              className="form-input min-h-11 min-w-0 text-base" />
          </label>
          {day && <div className="rounded-lg border border-white/10 p-3 text-sm">
            <h3 className="mb-2 font-semibold text-white">Day schedule</h3>
            {availabilityError ? <p>Could not load appointments.</p> : !appointments ? <p role="status">Checking schedule…</p> :
              <DayCalendar appointments={appointments} when={when} kind={kind} name={booking.name} />}
          </div>}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        </div>
        <footer className="flex flex-wrap gap-2 border-t border-white/10 p-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {booking.scheduledAt && <button type="button" onClick={() => void save(true)} disabled={busy}
            className="min-h-11 rounded-lg border border-white/15 px-3 text-amber-300">Unschedule</button>}
          <button type="button" onClick={() => void save()} disabled={busy || !when}
            className="min-h-11 flex-1 rounded-lg bg-sky-500 px-3 font-semibold text-navy-900 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save appointment'}
          </button>
        </footer>
      </section>
    </dialog>
  );
}
