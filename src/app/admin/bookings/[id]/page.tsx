'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Phone, Mail, MapPin, CalendarDays, DollarSign, StickyNote,
  User, Wallet, Clock, Edit3, Check, X, CalendarClock,
  Camera, Trash2, Repeat, FileText, FileSignature, Send, Link2, ExternalLink, Plus, Copy, Share as ShareIcon, Star, AlertTriangle, Compass,
} from 'lucide-react';
import type { Booking, BookingStatus, BookingPhoto, PhotoType } from '@/lib/db';
import type { Invoice } from '@/lib/invoice';
import { type Quote, money as quoteMoney, buildQuoteText } from '@/lib/quote';
import { AddressLink } from '@/components/AddressLink';
import { FlagButton, FlagModal } from '@/components/admin/JobFlag';
import QuoteModal from '@/components/QuoteModal';

type GuestProfile = { id: string; name: string; active: boolean; createdAt: string };

// "Scheduled: Tuesday 3:00 PM" within 7 days; "Scheduled: 15 August 2026" further out.
function scheduledLabel(iso: string): string {
  const d = new Date(iso);
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = (day0(d) - day0(new Date())) / 86400000;
  if (diffDays >= 0 && diffDays < 7) {
    return `${d.toLocaleDateString('en-AU', { weekday: 'long' })} ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const INVOICE_STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const QUOTE_STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent' };

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
const STATUS_KEYS: BookingStatus[] = ['uncontacted', 'contacted', 'quoted', 'confirmed', 'completed', 'cancelled', 'cold'];
const STATUS_LABEL: Record<string, string> = { uncontacted: 'Uncontacted', contacted: 'Contacted', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead' };

const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';
const money = (n?: number | null) => typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '';

// Editable form: quoteAmount held as a string for the input; service is a CSV string;
// paidAt / completedAt / createdAtDate held as YYYY-MM-DD strings for the date inputs.
type EditForm = Omit<Booking, 'quoteAmount' | 'service' | 'completedAt' | 'paidAt' | 'scheduledAt'> & { quoteAmount: string; service: string; completedAt: string; paidAt: string; scheduledAt: string; createdAtDate: string };
const toForm = (b: Booking): EditForm => ({
  ...b,
  quoteAmount: b.quoteAmount != null ? String(b.quoteAmount) : '',
  completedAt: b.completedAt ? b.completedAt.slice(0, 10) : '',
  paidAt: b.paidAt ? b.paidAt.slice(0, 10) : '',
  scheduledAt: toLocalInput(b.scheduledAt ?? null),
  createdAtDate: b.createdAt.slice(0, 10),
});

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

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
                  {/* No `capture` attr: iPhone then offers Photo Library / camera roll
                      as well as Take Photo, instead of forcing the rear camera. */}
                  <input
                    type="file"
                    accept="image/*"
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
  const [from, setFrom] = useState<string | null>(null);

  // Guest assignment ("Send to")
  const [guests, setGuests] = useState<GuestProfile[]>([]);
  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);

  // Linked invoices (linkage lives on the invoice; the booking derives them)
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showLink, setShowLink] = useState(false);

  // Quotes — generating one also drives this booking's quoteAmount/status (see syncQuoteAmountToBooking in db.ts)
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);

  // Flag — mark something's gone wrong on this job, with a note
  const [showFlag, setShowFlag] = useState(false);

  // Customer thank-you link
  const [custToken, setCustToken] = useState<string>('');
  useEffect(() => { if (b?.publicToken) setCustToken(b.publicToken); }, [b?.publicToken]);
  const custLink = custToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/thanks/${custToken}` : '';
  const genCustLink = async () => {
    if (!b) return;
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}/token`, { method: 'POST' });
      if (res.ok) { setCustToken((await res.json()).token); }
    } catch { toast.error('Could not create link'); }
  };
  const copyCustLink = async () => {
    try { await navigator.clipboard.writeText(custLink); toast.success('Customer link copied'); }
    catch { toast.error('Copy failed'); }
  };
  const loadInvoices = async () => {
    try {
      const res = await fetch('/api/admin/invoices');
      if (res.ok) setInvoices(await res.json());
    } catch { /* no invoices — fine */ }
  };
  const loadQuotes = async () => {
    try {
      const res = await fetch(`/api/admin/quotes?bookingId=${id}`);
      if (res.ok) setQuotes(await res.json());
    } catch { /* no quotes — fine */ }
  };
  // A quote's Copy/Share buttons update this booking's quoteAmount/status
  // server-side (see syncQuoteAmountToBooking) — re-fetch the booking too so
  // the read-only Quote row picks it up without a full page reload.
  const refreshBooking = async () => {
    try {
      const res = await fetch(`/api/admin/bookings/${id}`);
      if (res.ok) { const updated: Booking = await res.json(); setB(updated); setForm(toForm(updated)); }
    } catch { /* stays stale until next reload — fine */ }
  };
  const onQuoteSaved = (q: Quote) => {
    setQuotes(prev => prev.some(x => x.id === q.id) ? prev.map(x => x.id === q.id ? q : x) : [q, ...prev]);
    refreshBooking();
  };
  const shareQuote = async (q: Quote) => {
    const url = `${window.location.origin}/quote/${q.token}`;
    const title = `Quote ${q.number} · ${q.fromTradingAs}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) { try { await nav.share({ title, text: title, url }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Copy failed'); } }
  };
  const copyQuote = async (q: Quote) => {
    try { await navigator.clipboard.writeText(buildQuoteText(q)); toast.success('Quote text copied'); }
    catch { toast.error('Copy failed'); }
  };

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

  // Invoices, to show which are linked to this booking.
  useEffect(() => { loadInvoices(); }, []);

  // Quotes for this booking.
  useEffect(() => { loadQuotes(); }, [id]);

  // Guest logins, for the "Send to" selector.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/guests');
        if (res.ok) setGuests(await res.json());
      } catch { /* selector stays empty */ }
    })();
  }, []);

  // Assign (or unassign) this job to a subcontractor.
  const assignTo = async (guestId: string | null) => {
    if (!b) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedGuestId: guestId }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setB(updated);
      setShowSend(false);
      toast.success(guestId ? `Sent to ${guests.find(g => g.id === guestId)?.name ?? 'guest'}` : 'Job unassigned');
    } catch { toast.error('Could not send job'); }
    finally { setSending(false); }
  };

  const linkedInvoices = b ? invoices.filter(inv => inv.bookingIds.includes(b.id)) : [];
  const unlinkedInvoices = b ? invoices.filter(inv => !inv.bookingIds.includes(b.id)) : [];

  // Add/remove this booking from an invoice's linked set (edits the invoice —
  // the single source of truth for linkage).
  const toggleInvoiceLink = async (inv: Invoice, link: boolean) => {
    if (!b) return;
    const bookingIds = link
      ? Array.from(new Set([...inv.bookingIds, b.id]))
      : inv.bookingIds.filter(x => x !== b.id);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookingIds }),
      });
      if (!res.ok) throw new Error();
      await loadInvoices();
      setShowLink(false);
      toast.success(link ? `Linked invoice ${inv.number}` : `Unlinked ${inv.number}`);
    } catch { toast.error('Could not update link'); }
  };

  const set = (k: keyof EditForm, v: string | boolean) => setForm(f => f ? { ...f, [k]: v } : f);
  const toggleService = (v: string) => setForm(f => {
    if (!f) return f;
    const list = f.service ? f.service.split(',') : [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    return { ...f, service: next.join(',') };
  });

  // Website lead followed up — flips status to "Contacted", which drops it
  // out of "Leads to call back" on the dashboard (contactedAt auto-stamps
  // server-side — see withContactedAt in db.ts).
  const markContacted = async () => {
    if (!b) return;
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'contacted' }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setB(updated); setForm(toForm(updated));
      toast.success('Marked as contacted');
    } catch { toast.error('Could not update'); }
  };

  const flagSave = async (note: string) => {
    if (!b) return;
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagNote: note, flaggedAt: b.flaggedAt ?? new Date().toISOString() }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setB(updated); setForm(toForm(updated));
      setShowFlag(false);
      toast.success('Job flagged');
    } catch { toast.error('Could not save flag'); }
  };
  const flagClear = async () => {
    if (!b) return;
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagNote: null, flaggedAt: null }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setB(updated); setForm(toForm(updated));
      setShowFlag(false);
      toast.success('Flag cleared');
    } catch { toast.error('Could not clear flag'); }
  };

  const startEdit = () => { if (b) setForm(toForm(b)); setEdit(true); };
  const cancel = () => { if (b) setForm(toForm(b)); setEdit(false); };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {
        name: form.name, phone: form.phone, email: form.email, service: form.service,
        propertyType: form.propertyType, address: form.address, suburb: form.suburb,
        attributionSource: form.attributionSource?.trim() ? form.attributionSource.trim() : null,
        preferredDate: form.preferredDate, preferredTime: form.preferredTime,
        status: form.status, paid: form.paid, notes: form.notes, adminNotes: form.adminNotes,
        quoteAmount: form.quoteAmount.trim() === '' ? null : Number(form.quoteAmount.replace(/[^0-9.]/g, '')),
      };
      // Scheduling. An explicit datetime in the form wins. If the booking is being
      // confirmed but has no calendar slot, prompt to add one (default: preferred
      // date at 9am, else tomorrow) — this is the "Add this booking to the calendar?"
      // step. Two-way sync is automatic: this writes the booking, which the
      // calendar reads directly.
      let scheduledAtISO = form.scheduledAt ? fromLocalInput(form.scheduledAt) : (b?.scheduledAt ?? null);
      if (form.status === 'confirmed' && !scheduledAtISO) {
        if (window.confirm('Add this booking to the calendar?')) {
          const base = /^\d{4}-\d{2}-\d{2}$/.test(form.preferredDate)
            ? form.preferredDate
            : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
          scheduledAtISO = new Date(`${base}T09:00:00`).toISOString();
          toast.success('Added to calendar, adjust the time on the calendar');
        }
      }
      patch.scheduledAt = scheduledAtISO;
      // Completion date: send an explicit value when set or when clearing an existing
      // one. Leaving it out lets the server auto-stamp the day it flips to completed.
      if (form.completedAt.trim() !== '') patch.completedAt = new Date(`${form.completedAt}T00:00:00`).toISOString();
      else if (b?.completedAt) patch.completedAt = null;
      // Paid date: same rules. If not paid, clear any existing date; if paid with a
      // set date, send it; if paid but blank, omit so the server stamps today.
      if (!form.paid) { if (b?.paidAt) patch.paidAt = null; }
      else if (form.paidAt.trim() !== '') patch.paidAt = new Date(`${form.paidAt}T00:00:00`).toISOString();
      // Date added: only send it if the date actually changed, so the original time-of-day survives untouched.
      if (form.createdAtDate && form.createdAtDate !== b?.createdAt.slice(0, 10)) {
        patch.createdAt = new Date(`${form.createdAtDate}T00:00:00`).toISOString();
      }
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
          {state === 'ok' && b && !edit && (
            <FlagButton booking={b} onClick={() => setShowFlag(true)} />
          )}
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
                  {b.source === 'manual' ? 'Added manually' : b.source === 'facebook-lead-ad' ? 'Facebook lead ad' : 'From website'} · {new Date(b.createdAt).toLocaleDateString('en-AU')}
                </div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0 badge-${b.status}`}>
                {STATUS_LABEL[b.status] ?? b.status}
              </span>
            </div>

            {b.flaggedAt && (
              <button
                onClick={() => setShowFlag(true)}
                className="mb-5 w-full flex items-start gap-2.5 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3.5 text-left cursor-pointer hover:bg-red-500/15 transition-colors"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="text-red-300 font-semibold">Flagged: something&apos;s gone wrong</div>
                  {b.flagNote && <div className="text-red-200/90 mt-0.5 whitespace-pre-wrap break-words">{b.flagNote}</div>}
                  <div className="text-red-300/70 text-xs mt-1">{longDate(b.flaggedAt)} · tap to edit or clear</div>
                </div>
              </button>
            )}

            {b.source === 'website' && b.status === 'uncontacted' && (
              <button onClick={markContacted} className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15 text-base font-semibold transition-colors cursor-pointer">
                <Check className="w-5 h-5" /> Mark as Contacted
              </button>
            )}

            <div className="mb-5 grid grid-cols-2 gap-3">
              {/* Opens the calendar in scheduling mode: pick a day and the slot is
                  filled in from this booking, on this same record. */}
              <button onClick={() => router.push(`/admin/calendar?schedule=${b.id}`)} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-sm font-semibold transition-colors cursor-pointer">
                <CalendarClock className="w-4 h-4" /> {b.scheduledAt ? 'Reschedule' : 'Add to calendar'}
              </button>
              <button onClick={() => setShowSend(true)} className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-sm font-semibold transition-colors cursor-pointer touch-manipulation">
                <Send className="w-4 h-4" /> Send to
              </button>
            </div>

            <div className="rounded-lg border border-white/10 bg-navy-800 px-4">
              {b.phone && <Row icon={Phone} label="Phone"><a href={`tel:${b.phone}`} className="text-sky-400">{b.phone}</a></Row>}
              {b.email && <Row icon={Mail} label="Email"><a href={`mailto:${b.email}`} className="text-sky-400 break-all">{b.email}</a></Row>}
              {b.attributionSource && <Row icon={Compass} label="Found us via">{b.attributionSource}</Row>}
              <Row icon={User} label="Service">{serviceText(b.service)}{b.propertyType === 'commercial' ? ' · Commercial' : ''}</Row>
              {(b.address || b.suburb) && <Row icon={MapPin} label="Address"><AddressLink address={[b.address, b.suburb].filter(Boolean).join(', ')} /></Row>}
              {(b.preferredDate || b.preferredTime) && <Row icon={CalendarDays} label="Preferred time">{[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}</Row>}
              <Row icon={CalendarClock} label="Calendar">
                {b.scheduledAt
                  ? <span className="text-sky-300">Scheduled: {scheduledLabel(b.scheduledAt)}</span>
                  : b.status === 'confirmed'
                    ? <span className="text-amber-300">Not in calendar</span>
                    : <span className="text-slate-500">Not scheduled</span>}
              </Row>
              <Row icon={Send} label="Assigned to">
                {b.assignedGuestId ? (
                  <span className="text-sky-300">
                    {guests.find(g => g.id === b.assignedGuestId)?.name ?? 'Guest'}
                    {b.assignedAt && <span className="text-slate-500"> · sent {longDate(b.assignedAt)}</span>}
                  </span>
                ) : (
                  <span className="text-slate-500">Unassigned</span>
                )}
              </Row>
              <Row icon={DollarSign} label="Quote">{typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? money(b.quoteAmount) : 'No quote yet'}</Row>
              <Row icon={Wallet} label="Payment">
                <span className={b.paid ? 'text-emerald-400' : 'text-red-300'}>{b.paid ? 'Paid' : 'Not paid'}</span>
                {b.paid && <span className="text-slate-500"> · {b.paidAt ? longDate(b.paidAt) : 'date not set'}</span>}
              </Row>
              {!b.paid && b.customerMarkedPaidAt && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-amber-200 text-sm">
                    <span className="font-semibold">Customer says they&apos;ve paid</span>, {longDate(b.customerMarkedPaidAt)}.
                    <span className="text-amber-300/80"> Not marked paid here yet, check the bank first.</span>
                  </div>
                </div>
              )}
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

            {/* Quotes — generating one drives this booking's quoteAmount/status */}
            <div className="mt-4 rounded-lg border border-white/10 bg-navy-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-slate-500 text-xs flex items-center gap-1.5"><FileSignature className="w-3.5 h-3.5" /> Quotes</div>
                <button onClick={() => { setEditingQuote(null); setShowQuoteModal(true); }} className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> New quote
                </button>
              </div>
              {quotes.length === 0 ? (
                <div className="text-slate-500 text-sm">No quotes yet. Generating one also updates this booking&apos;s quote amount and status.</div>
              ) : (
                <div className="space-y-2">
                  {quotes.map(q => (
                    <div key={q.id} className="rounded-lg border border-white/10 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setEditingQuote(q); setShowQuoteModal(true); }} className="min-w-0 flex-1 text-left cursor-pointer">
                          <div className="text-white text-sm font-medium">{q.number} · {quoteMoney(q.amount)}</div>
                          <div className="text-slate-500 text-xs">{QUOTE_STATUS_LABEL[q.status] ?? q.status} · {new Date(q.quoteDate).toLocaleDateString('en-AU')}</div>
                        </button>
                        <button onClick={() => copyQuote(q)} title="Copy quote text" className="p-2 rounded-lg border border-white/10 text-slate-300 hover:border-sky-400/40 cursor-pointer"><Copy className="w-4 h-4" /></button>
                        <button onClick={() => shareQuote(q)} title="Share quote link" className="p-2 rounded-lg border border-white/10 text-slate-300 hover:border-sky-400/40 cursor-pointer"><ShareIcon className="w-4 h-4" /></button>
                        <a href={`/quote/${q.token}`} target="_blank" rel="noopener noreferrer" title="Open" className="p-2 rounded-lg border border-white/10 text-sky-300 hover:border-sky-400/40 cursor-pointer"><ExternalLink className="w-4 h-4" /></a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Linked invoices — payment status flows from invoice → booking */}
            <div className="mt-4 rounded-lg border border-white/10 bg-navy-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-slate-500 text-xs flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Linked invoices</div>
                <button onClick={() => { setShowLink(true); loadInvoices(); }} className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Link invoice
                </button>
              </div>
              {linkedInvoices.length === 0 ? (
                <div className="text-slate-500 text-sm">No invoices linked. When a linked invoice is marked paid, this job is marked paid too.</div>
              ) : (
                <div className="space-y-2">
                  {linkedInvoices.map(inv => (
                    <div key={inv.id} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-white text-sm font-medium">{inv.number} · {money(inv.total)}</div>
                        <div className="text-slate-500 text-xs">
                          {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}
                          {inv.firstViewedAt ? ' · Read' : ''}
                          {inv.status === 'paid' ? ' · Paid' : ''}
                        </div>
                      </div>
                      <Link href={`/admin/invoices/${inv.id}?from=/admin/bookings/${b.id}`} title="View invoice" className="p-2 rounded-lg border border-white/10 text-sky-300 hover:border-sky-400/40 cursor-pointer"><ExternalLink className="w-4 h-4" /></Link>
                      <button onClick={() => toggleInvoiceLink(inv, false)} title="Unlink" className="p-2 rounded-lg border border-white/10 text-red-400 hover:border-red-400/40 cursor-pointer"><X className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Customer thank-you link + feedback */}
            <div className="mt-4 rounded-lg border border-white/10 bg-navy-800 p-4">
              <div className="text-slate-500 text-xs flex items-center gap-1.5 mb-3"><Star className="w-3.5 h-3.5" /> Customer link (thank-you, invoice, photos, feedback)</div>
              {custLink ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input readOnly value={custLink} onFocus={e => e.currentTarget.select()} className="form-input flex-1 min-w-[12rem] text-xs" />
                  <button onClick={copyCustLink} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer"><Copy className="w-4 h-4" /> Copy</button>
                  <a href={custLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/15 text-slate-200 hover:text-white text-sm font-semibold cursor-pointer"><ExternalLink className="w-4 h-4" /></a>
                </div>
              ) : (
                <button onClick={genCustLink} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 text-sm font-semibold cursor-pointer"><Link2 className="w-4 h-4" /> Create customer link</button>
              )}
              {typeof b.feedbackStars === 'number' && (
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(n => <Star key={n} className={`w-4 h-4 ${n <= b.feedbackStars! ? 'fill-amber-400 text-amber-400' : 'text-slate-600'}`} />)}
                    <span className="text-slate-400 text-xs ml-1">{b.feedbackAt ? longDate(b.feedbackAt) : ''}</span>
                  </div>
                  {b.feedbackText && <div className="text-slate-300 text-sm mt-1.5 whitespace-pre-wrap">{b.feedbackText}</div>}
                </div>
              )}
            </div>

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
              <div><FieldLabel>Found us via</FieldLabel><input className="form-input" placeholder="Auto-detected, e.g. Facebook (bio link)" value={form.attributionSource ?? ''} onChange={e => set('attributionSource', e.target.value)} /></div>
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
              <div><FieldLabel>Date added</FieldLabel><input className="form-input" type="date" value={form.createdAtDate} onChange={e => set('createdAtDate', e.target.value)} /></div>
              <div className="sm:col-span-2">
                <FieldLabel>Scheduled slot (calendar)</FieldLabel>
                <div className="flex items-center gap-2">
                  <input className="form-input" type="datetime-local" value={form.scheduledAt} onChange={e => set('scheduledAt', e.target.value)} />
                  {form.scheduledAt && <button type="button" onClick={() => set('scheduledAt', '')} className="px-3 py-2.5 rounded-lg border border-white/10 text-slate-400 hover:text-white text-sm cursor-pointer">Clear</button>}
                </div>
                <p className="text-slate-500 text-xs mt-1">Sets the internal calendar slot. Clear to remove from the calendar.</p>
              </div>
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

      {/* ── Send to guest ─────────────────────────────────────────── */}
      {showSend && b && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowSend(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[80svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Send className="w-4 h-4 text-sky-400" /> Send job to</h3>
              <button onClick={() => setShowSend(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
              {guests.filter(g => g.active).length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">
                  No guest logins yet.
                  <Link href="/admin/settings" className="block mt-2 text-sky-400 hover:text-sky-300">Create one</Link>
                </div>
              ) : (
                guests.filter(g => g.active).map(g => {
                  const on = b.assignedGuestId === g.id;
                  return (
                    <button
                      key={g.id}
                      onClick={() => assignTo(g.id)}
                      disabled={sending}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left cursor-pointer disabled:opacity-50 ${on ? 'bg-sky-400/10 text-sky-300' : 'hover:bg-white/5 text-white'}`}
                    >
                      <span className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {g.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="flex-1 text-sm font-medium">{g.name}</span>
                      {on && <Check className="w-4 h-4 flex-shrink-0" />}
                    </button>
                  );
                })
              )}
              {b.assignedGuestId && (
                <button onClick={() => assignTo(null)} disabled={sending} className="w-full mt-1 p-3 rounded-lg text-left text-sm font-medium text-red-400 hover:bg-red-400/10 cursor-pointer disabled:opacity-50">
                  Unassign this job
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Quote maker ───────────────────────────────────────────── */}
      {showQuoteModal && b && (
        <QuoteModal
          bookingId={b.id}
          booking={b}
          initial={editingQuote}
          onClose={() => setShowQuoteModal(false)}
          onSaved={onQuoteSaved}
        />
      )}

      {/* ── Flag a problem ────────────────────────────────────────── */}
      {showFlag && b && (
        <FlagModal
          booking={b}
          onClose={() => setShowFlag(false)}
          onSave={flagSave}
          onClear={flagClear}
        />
      )}

      {/* ── Link an existing invoice ──────────────────────────────── */}
      {showLink && b && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowLink(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[80svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Link2 className="w-4 h-4 text-sky-400" /> Link an invoice</h3>
              <button onClick={() => setShowLink(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
              {unlinkedInvoices.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">
                  No other invoices to link.
                  <Link href={`/admin/invoices/new?fromBooking=${b.id}`} className="block mt-2 text-sky-400 hover:text-sky-300">Create one from this booking</Link>
                </div>
              ) : (
                unlinkedInvoices.map(inv => (
                  <button key={inv.id} onClick={() => toggleInvoiceLink(inv, true)} className="w-full flex items-center gap-3 p-3 rounded-lg text-left cursor-pointer hover:bg-white/5 text-white">
                    <FileText className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{inv.number} · {money(inv.total)}</span>
                      <span className="block text-slate-500 text-xs truncate">{inv.billToName || 'No bill-to'} · {INVOICE_STATUS_LABEL[inv.status] ?? inv.status}</span>
                    </span>
                    <Plus className="w-4 h-4 flex-shrink-0 text-sky-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
