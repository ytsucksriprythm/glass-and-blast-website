'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Phone, Mail, MapPin, CalendarDays, DollarSign, StickyNote,
  CalendarPlus, User, Wallet, Clock, Edit3, Check, X, CalendarCheck,
  Camera, Trash2, Repeat, FileText,
} from 'lucide-react';
import type { Booking, BookingStatus, BookingPhoto, PhotoType } from '@/lib/db';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing',
  'pressure-washing': 'Pressure Washing',
  'both': 'Both Services',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'other': 'Other',
};
const SERVICE_OPTIONS = [
  { v: 'window-washing', l: 'Window Washing' },
  { v: 'pressure-washing', l: 'Pressure Washing' },
  { v: 'flyscreen-repair', l: 'Flyscreen Repair' },
  { v: 'solar-panel-cleaning', l: 'Solar Panel Cleaning' },
  { v: 'other', l: 'Other' },
];
const STATUS_KEYS: BookingStatus[] = ['pending', 'quoted', 'confirmed', 'completed', 'cancelled'];
const STATUS_LABEL: Record<string, string> = { pending: 'Pending', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };

const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';
const money = (n?: number | null) => typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '';

// Editable form: quoteAmount held as a string for the input; service is a CSV string;
// paidAt / completedAt held as YYYY-MM-DD strings for the date inputs.
type EditForm = Omit<Booking, 'quoteAmount' | 'service' | 'completedAt' | 'paidAt'> & { quoteAmount: string; service: string; completedAt: string; paidAt: string };
const toForm = (b: Booking): EditForm => ({
  ...b,
  quoteAmount: b.quoteAmount != null ? String(b.quoteAmount) : '',
  completedAt: b.completedAt ? b.completedAt.slice(0, 10) : '',
  paidAt: b.paidAt ? b.paidAt.slice(0, 10) : '',
});

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

// A matched Google Calendar event (read-only feed).
type CalEvent = { uid: string; title: string; location: string; dow: string; day: string; mon: string; timeLabel: string; allDay: boolean };
function eventMatchesBooking(title: string, b: Booking): boolean {
  const t = title.toLowerCase();
  return !!(b.name && t.includes(b.name.toLowerCase().trim()))
    || !!(b.address && b.address.length > 3 && t.includes(b.address.toLowerCase().trim()));
}

function gcalUrl(b: Booking): string {
  const place = [b.address, b.suburb].filter(Boolean).join(', ');
  const title = (place ? `${place} - ${b.name}` : b.name).trim();
  const details = [
    b.phone ? `Phone: ${b.phone}` : '',
    b.email ? `Email: ${b.email}` : '',
    `Service: ${serviceText(b.service)}`,
    b.propertyType ? `Type: ${b.propertyType}` : '',
    (typeof b.quoteAmount === 'number' && b.quoteAmount > 0) ? `Quote: ${money(b.quoteAmount)}` : '',
    (b.preferredDate || b.preferredTime) ? `Preferred: ${[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}` : '',
    b.notes ? `Customer note: ${b.notes}` : '',
    b.adminNotes ? `Admin note: ${b.adminNotes}` : '',
  ].filter(Boolean).join('\n');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: title, details, location: place });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function Row({ icon: Icon, label, children }: { icon: React.FC<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
      <Icon className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-slate-500 text-xs">{label}</div>
        <div className="text-white text-sm mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}

// ─── Before / after photo gallery ────────────────────────────────────────────
// Camera-first: on iPhone the "Add" buttons open the camera straight away.
// Uploads are compressed server-side (HEIC → JPEG, resized) so slow mobile
// connections only carry the file once.

function PhotoGallery({ bookingId }: { bookingId: string }) {
  const [photos, setPhotos] = useState<BookingPhoto[]>([]);
  const [uploading, setUploading] = useState<PhotoType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${bookingId}/photos`);
        if (res.ok) setPhotos(await res.json());
      } catch { /* gallery is optional — fail quiet */ }
      finally { setLoading(false); }
    })();
  }, [bookingId]);

  const upload = async (type: PhotoType, file: File | null) => {
    if (!file) return;
    setUploading(type);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      const res = await fetch(`/api/admin/bookings/${bookingId}/photos`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const photo: BookingPhoto = await res.json();
      setPhotos(p => [...p, photo]);
      toast.success(`${type === 'before' ? 'Before' : 'After'} photo added`);
      if (navigator.vibrate) navigator.vibrate(50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed, try again');
    } finally {
      setUploading(null);
    }
  };

  const remove = async (photo: BookingPhoto) => {
    if (!window.confirm('Delete this photo?')) return;
    const prev = photos;
    setPhotos(p => p.filter(x => x.id !== photo.id));
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/photos/${photo.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
    } catch {
      setPhotos(prev);
      toast.error('Delete failed');
    }
  };

  const groups: { type: PhotoType; label: string }[] = [
    { type: 'before', label: 'Before' },
    { type: 'after', label: 'After' },
  ];

  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-navy-800 p-4">
      <div className="text-slate-500 text-xs mb-3 flex items-center gap-1.5">
        <Camera className="w-3.5 h-3.5" /> Job photos
      </div>
      <div className="grid grid-cols-2 gap-3">
        {groups.map(g => {
          const list = photos.filter(p => p.type === g.type);
          return (
            <div key={g.type}>
              <div className="text-slate-400 text-xs font-semibold mb-2">{g.label} {loading ? '' : `(${list.length})`}</div>
              <div className="grid grid-cols-2 gap-2">
                {loading && [0, 1].map(i => <div key={i} className="aspect-square rounded-md bg-white/5 animate-pulse" />)}
                {!loading && list.map(p => (
                  <div key={p.id} className="relative group aspect-square rounded-md overflow-hidden border border-white/10">
                    {/* Blob URLs are cross-origin; plain img keeps it simple */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      <img src={p.url} alt={`${g.label} photo`} className="w-full h-full object-cover" loading="lazy" />
                    </a>
                    <button
                      onClick={() => remove(p)}
                      aria-label="Delete photo"
                      className="absolute top-1 right-1 w-7 h-7 rounded-md bg-black/60 text-red-300 flex items-center justify-center cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {!loading && (
                <label className={`aspect-square rounded-md border border-dashed border-white/20 hover:border-sky-400/50 flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-sky-300 text-xs cursor-pointer transition-colors ${uploading === g.type ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploading === g.type
                    ? <div className="w-5 h-5 border-2 border-white/20 border-t-sky-400 rounded-full animate-spin" />
                    : <><Camera className="w-5 h-5" /> Add</>}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={e => { upload(g.type, e.target.files?.[0] ?? null); e.target.value = ''; }}
                  />
                </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BookingView() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [b, setB] = useState<Booking | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [calEvents, setCalEvents] = useState<CalEvent[]>([]);
  const [from, setFrom] = useState<string | null>(null);

  // Remember the page we were opened from (passed as ?from=…) so Back returns
  // there exactly — including the dashboard tab — instead of relying on browser
  // history, which resets the dashboard to its default tab or exits the PWA.
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('from');
    if (f && f.startsWith('/admin')) setFrom(f); // same-app paths only
  }, []);

  const goBack = () => {
    if (from) router.push(from);
    else if (window.history.length > 1) router.back();
    else router.push('/admin/dashboard');
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${id}`);
        if (res.status === 401) { router.push('/admin'); return; }
        if (res.status === 404) { setState('notfound'); return; }
        const data: Booking = await res.json();
        setB(data); setForm(toForm(data)); setState('ok');
      } catch { setState('notfound'); }
    })();
  }, [id, router]);

  // Pull the read-only Google Calendar feed so we can show the scheduled slot if matched.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/calendar');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.events)) setCalEvents(data.events);
      } catch { /* no calendar — fine */ }
    })();
  }, []);

  const calMatch = b ? calEvents.find(e => eventMatchesBooking(e.title, b)) : undefined;

  const set = (k: keyof EditForm, v: string | boolean) => setForm(f => f ? { ...f, [k]: v } : f);
  const toggleService = (v: string) => setForm(f => {
    if (!f) return f;
    const list = f.service ? f.service.split(',') : [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    return { ...f, service: next.join(',') };
  });

  const startEdit = () => { if (b) setForm(toForm(b)); setEdit(true); };
  const cancel = () => { if (b) setForm(toForm(b)); setEdit(false); };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        name: form.name, phone: form.phone, email: form.email, service: form.service,
        propertyType: form.propertyType, address: form.address, suburb: form.suburb,
        preferredDate: form.preferredDate, preferredTime: form.preferredTime,
        status: form.status, paid: form.paid, notes: form.notes, adminNotes: form.adminNotes,
        quoteAmount: form.quoteAmount.trim() === '' ? null : Number(form.quoteAmount.replace(/[^0-9.]/g, '')),
      };
      // Completion date: send an explicit value when set or when clearing an existing
      // one. Leaving it out lets the server auto-stamp the day it flips to completed.
      if (form.completedAt.trim() !== '') patch.completedAt = new Date(`${form.completedAt}T00:00:00`).toISOString();
      else if (b?.completedAt) patch.completedAt = null;
      // Paid date: same rules. If not paid, clear any existing date; if paid with a
      // set date, send it; if paid but blank, omit so the server stamps today.
      if (!form.paid) { if (b?.paidAt) patch.paidAt = null; }
      else if (form.paidAt.trim() !== '') patch.paidAt = new Date(`${form.paidAt}T00:00:00`).toISOString();
      const res = await fetch(`/api/admin/bookings/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setB(updated); setForm(toForm(updated)); setEdit(false);
      toast.success('Saved');
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const selectedServices = form?.service ? form.service.split(',') : [];

  return (
    <div className="min-h-[100svh] bg-navy-900">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        {edit ? (
          <button onClick={cancel} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer">
            <X className="w-5 h-5" /> Cancel
          </button>
        ) : (
          <button onClick={goBack} className="inline-flex items-center gap-2 -ml-2 px-2 py-2 rounded-lg text-slate-300 hover:text-white active:bg-white/10 text-sm cursor-pointer transition-colors touch-manipulation">
            <ArrowLeft className="w-5 h-5" /> Back
          </button>
        )}
        <div className="flex items-center gap-3">
          {state === 'ok' && !edit && (
            <button onClick={startEdit} aria-label="Edit booking" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:border-sky-400/40 text-sm cursor-pointer">
              <Edit3 className="w-4 h-4" /> Edit
            </button>
          )}
          {!edit && <Link href="/admin/dashboard" className="text-slate-500 text-sm hover:text-sky-400">Dashboard</Link>}
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 pb-28">
        {state === 'loading' && (
          <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}</div>
        )}

        {state === 'notfound' && (
          <div className="text-center py-20 text-slate-500">
            Booking not found. <Link href="/admin/dashboard" className="text-sky-400">Back to dashboard</Link>
          </div>
        )}

        {/* ── READ MODE ────────────────────────────────────────────── */}
        {state === 'ok' && b && !edit && (
          <>
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold text-white break-words">{b.name}</h1>
                <div className="text-slate-500 text-xs mt-1">
                  {b.source === 'manual' ? 'Added manually' : 'From website'} · {new Date(b.createdAt).toLocaleDateString('en-AU')}
                </div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0 badge-${b.status}`}>
                {STATUS_LABEL[b.status] ?? b.status}
              </span>
            </div>

            <a href={gcalUrl(b)} target="_blank" rel="noopener noreferrer" className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-sm font-semibold transition-colors cursor-pointer">
              <CalendarPlus className="w-4 h-4" /> Add to Google Calendar
            </a>

            <div className="rounded-lg border border-white/10 bg-navy-800 px-4">
              {b.phone && <Row icon={Phone} label="Phone"><a href={`tel:${b.phone}`} className="text-sky-400">{b.phone}</a></Row>}
              {b.email && <Row icon={Mail} label="Email"><a href={`mailto:${b.email}`} className="text-sky-400 break-all">{b.email}</a></Row>}
              <Row icon={User} label="Service">{serviceText(b.service)} · <span className="capitalize">{b.propertyType}</span></Row>
              {(b.address || b.suburb) && <Row icon={MapPin} label="Address">{[b.address, b.suburb].filter(Boolean).join(', ')}</Row>}
              {(b.preferredDate || b.preferredTime) && <Row icon={CalendarDays} label="Preferred time">{[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}</Row>}
              {calMatch && (
                <Row icon={CalendarCheck} label="Scheduled (Google Calendar)">
                  <span className="text-sky-300">{calMatch.dow} {calMatch.day} {calMatch.mon}{calMatch.allDay ? '' : ` · ${calMatch.timeLabel}`}</span>
                </Row>
              )}
              <Row icon={DollarSign} label="Quote">{typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? money(b.quoteAmount) : 'No quote yet'}</Row>
              <Row icon={Wallet} label="Payment">
                <span className={b.paid ? 'text-emerald-400' : 'text-red-300'}>{b.paid ? 'Paid' : 'Not paid'}</span>
                {b.paid && <span className="text-slate-500"> · {b.paidAt ? longDate(b.paidAt) : 'date not set'}</span>}
              </Row>
              {b.status === 'completed' && (
                <Row icon={Check} label="Completed on">
                  {b.completedAt ? longDate(b.completedAt) : 'Date not set'}
                </Row>
              )}
            </div>

            {(b.notes || b.adminNotes) && (
              <div className="mt-4 space-y-3">
                {b.notes && (
                  <div className="rounded-lg border border-white/10 bg-navy-800 p-4">
                    <div className="text-slate-500 text-xs mb-1 flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Customer note</div>
                    <div className="text-slate-200 text-sm whitespace-pre-wrap break-words">{b.notes}</div>
                  </div>
                )}
                {b.adminNotes && (
                  <div className="rounded-lg border border-white/10 bg-navy-800 p-4">
                    <div className="text-slate-500 text-xs mb-1 flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5 text-amber-400" /> Private note</div>
                    <div className="text-slate-200 text-sm whitespace-pre-wrap break-words">{b.adminNotes}</div>
                  </div>
                )}
              </div>
            )}

            <PhotoGallery bookingId={b.id} />

            <Link
              href={`/admin/invoices/new?fromBooking=${b.id}`}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:border-sky-400/40 text-sm font-semibold transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4 text-sky-400" /> Create an invoice from this booking
            </Link>

            <Link
              href={`/admin/recurring?prefill=${b.id}`}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:border-sky-400/40 text-sm font-semibold transition-colors cursor-pointer"
            >
              <Repeat className="w-4 h-4 text-sky-400" /> Put this customer on a recurring plan
            </Link>

            <div className="mt-4 text-slate-600 text-xs flex items-center gap-2">
              <Clock className="w-3 h-3" /> Updated {new Date(b.updatedAt).toLocaleString('en-AU')}
            </div>
          </>
        )}

        {/* ── EDIT MODE ────────────────────────────────────────────── */}
        {state === 'ok' && form && edit && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div><FieldLabel>Name</FieldLabel><input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
              <div><FieldLabel>Phone</FieldLabel><input className="form-input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
              <div><FieldLabel>Email</FieldLabel><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
              <div><FieldLabel>Suburb</FieldLabel><input className="form-input" value={form.suburb} onChange={e => set('suburb', e.target.value)} /></div>
              <div className="sm:col-span-2"><FieldLabel>Address</FieldLabel><input className="form-input" value={form.address} onChange={e => set('address', e.target.value)} /></div>
            </div>

            <div>
              <FieldLabel>Services</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {SERVICE_OPTIONS.map(o => {
                  const active = selectedServices.includes(o.v);
                  return (
                    <button key={o.v} type="button" onClick={() => toggleService(o.v)} className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${active ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                      {active ? '✓ ' : ''}{o.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>Property type</FieldLabel>
                <select className="form-input" value={form.propertyType} onChange={e => set('propertyType', e.target.value)}>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
              </div>
              <div>
                <FieldLabel>Status</FieldLabel>
                <select className="form-input" value={form.status} onChange={e => set('status', e.target.value)}>
                  {STATUS_KEYS.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div><FieldLabel>Preferred date</FieldLabel><input className="form-input" type="date" value={form.preferredDate} onChange={e => set('preferredDate', e.target.value)} /></div>
              <div><FieldLabel>Preferred time</FieldLabel><input className="form-input" placeholder="e.g. Morning" value={form.preferredTime} onChange={e => set('preferredTime', e.target.value)} /></div>
              <div>
                <FieldLabel>Quote (AUD)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input className="form-input pl-8" inputMode="decimal" placeholder="e.g. 250" value={form.quoteAmount} onChange={e => set('quoteAmount', e.target.value)} />
                </div>
              </div>
              <div>
                <FieldLabel>Paid</FieldLabel>
                <button type="button" onClick={() => set('paid', !form.paid)} className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors cursor-pointer ${form.paid ? 'bg-emerald-500/10 border-emerald-400/40' : 'bg-red-500/10 border-red-400/40'}`}>
                  <span className={`font-semibold text-sm ${form.paid ? 'text-emerald-300' : 'text-red-300'}`}>{form.paid ? 'Paid' : 'Not paid'}</span>
                  <span className={`w-5 h-5 rounded flex items-center justify-center border-2 flex-shrink-0 ${form.paid ? 'bg-emerald-500 border-emerald-500' : 'border-red-400/60'}`}>
                    {form.paid && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </span>
                </button>
              </div>
              {form.paid && (
                <div>
                  <FieldLabel>Paid on</FieldLabel>
                  <input className="form-input" type="date" value={form.paidAt} onChange={e => set('paidAt', e.target.value)} />
                  <p className="text-slate-500 text-xs mt-1">Leave blank to use the day it was marked paid.</p>
                </div>
              )}
              {form.status === 'completed' && (
                <div>
                  <FieldLabel>Completed on</FieldLabel>
                  <input className="form-input" type="date" value={form.completedAt} onChange={e => set('completedAt', e.target.value)} />
                  <p className="text-slate-500 text-xs mt-1">Leave blank to use the day it was marked completed.</p>
                </div>
              )}
            </div>

            <div><FieldLabel>Customer note</FieldLabel><textarea className="form-input resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
            <div><FieldLabel>Private note (only you see this)</FieldLabel><textarea className="form-input resize-none" rows={3} value={form.adminNotes ?? ''} onChange={e => set('adminNotes', e.target.value)} /></div>

            <div className="flex gap-3 pt-1">
              <button onClick={cancel} className="px-5 py-3 rounded-lg border border-white/10 text-slate-300 text-sm hover:text-white transition-colors cursor-pointer">Cancel</button>
              <button onClick={save} disabled={saving || !form.name} className="flex-1 py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Save changes
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
