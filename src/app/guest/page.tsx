'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  Briefcase, LogOut, Plus, X, Check, Lock, FileText, Phone as PhoneIcon, MapPin,
  CalendarDays, StickyNote, ShieldCheck, BarChart3, Globe, Users, Wallet,
} from 'lucide-react';
import type { Booking, BookingStatus } from '@/lib/db';

const STATUS_KEYS: BookingStatus[] = ['pending', 'quoted', 'confirmed', 'completed', 'cancelled'];
const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
};

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing',
  'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure',
  'other': 'Other',
};
const serviceText = (s: string) =>
  (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '—';

const money = (n?: number | null) => (typeof n === 'number' && n > 0 ? `$${n.toLocaleString('en-AU')}` : null);

type Me = { role: 'admin' | 'guest' | null; isAdmin: boolean; guest: { id: string; name: string } | null };

// Features a guest can see but not use.
const LOCKED = [
  { label: 'Business', icon: BarChart3 },
  { label: 'Site Stats', icon: Globe },
  { label: 'Guests', icon: Users },
];

function AdminPanelButton({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // An admin already viewing as a guest switches straight back — no password.
  const go = async () => {
    if (isAdmin) {
      setBusy(true);
      const res = await fetch('/api/admin/switch', { method: 'DELETE' });
      if (res.ok) router.push('/admin/dashboard');
      else { toast.error('Switch failed'); setBusy(false); }
      return;
    }
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, remember: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.role !== 'admin') { toast.error('Incorrect admin password'); setBusy(false); return; }
      router.push('/admin/dashboard');
    } catch { toast.error('Something went wrong'); setBusy(false); }
  };

  return (
    <>
      <button onClick={go} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-300 hover:text-white hover:border-sky-400/40 text-sm cursor-pointer disabled:opacity-50">
        <ShieldCheck className="w-4 h-4" /> Admin
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-white/10 bg-navy-800 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold flex items-center gap-2"><Lock className="w-4 h-4 text-sky-400" /> Admin password</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-slate-500 text-xs mb-3">Enter the admin password to open the admin panel.</p>
            <input
              type="password" autoComplete="current-password" autoFocus
              className="form-input text-base" placeholder="Admin password"
              value={password} onChange={e => setPassword(e.target.value)}
            />
            <button type="submit" disabled={!password || busy} className="mt-3 w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold cursor-pointer">
              {busy ? 'Checking…' : 'Open admin panel'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function AddBookingModal({ onClose, onCreated }: { onClose: () => void; onCreated: (b: Booking) => void }) {
  const [f, setF] = useState({ name: '', phone: '', address: '', suburb: '', service: 'window-washing', preferredDate: '', preferredTime: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/bookings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, propertyType: 'residential', status: 'confirmed' }),
      });
      if (!res.ok) throw new Error();
      const { booking } = await res.json();
      onCreated(booking);
      toast.success('Booking added');
      onClose();
    } catch { toast.error('Could not add booking'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90svh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-navy-800 p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-white font-semibold">New booking</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
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
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-slate-400 text-xs mb-1">Date</label><input type="date" className="form-input text-sm" value={f.preferredDate} onChange={e => set('preferredDate', e.target.value)} /></div>
            <div><label className="block text-slate-400 text-xs mb-1">Time</label><input className="form-input text-sm" placeholder="Morning" value={f.preferredTime} onChange={e => set('preferredTime', e.target.value)} /></div>
          </div>
          <div><label className="block text-slate-400 text-xs mb-1">Notes</label><textarea rows={2} className="form-input text-sm resize-none" value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
          <button onClick={save} disabled={saving} className="w-full py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold cursor-pointer flex items-center justify-center gap-2">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Add booking
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GuestDashboard() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [jobs, setJobs] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await fetch('/api/admin/bookings');
    if (res.ok) setJobs(await res.json());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data: Me = await res.json();
        if (data.role !== 'guest') { router.push(data.role === 'admin' ? '/admin/dashboard' : '/admin'); return; }
        setMe(data);
        await loadJobs();
      } finally { setLoading(false); }
    })();
  }, [router, loadJobs]);

  const setStatus = async (b: Booking, status: BookingStatus) => {
    setBusyId(b.id);
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setJobs(list => list.map(j => j.id === b.id ? updated : j));
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
    } catch { toast.error('Update failed'); }
    finally { setBusyId(null); }
  };

  const togglePaid = async (b: Booking) => {
    setBusyId(b.id);
    try {
      const res = await fetch(`/api/admin/bookings/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: !b.paid }),
      });
      if (!res.ok) throw new Error();
      const updated: Booking = await res.json();
      setJobs(list => list.map(j => j.id === b.id ? updated : j));
    } catch { toast.error('Update failed'); }
    finally { setBusyId(null); }
  };

  const logout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin');
  };

  const open = jobs.filter(j => j.status !== 'completed' && j.status !== 'cancelled');
  const done = jobs.filter(j => j.status === 'completed' || j.status === 'cancelled');

  return (
    <div className="min-h-[100svh] bg-navy-900">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between gap-3"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <div className="min-w-0">
          <div className="text-white font-semibold truncate">{me?.guest?.name ?? 'Jobs'}</div>
          <div className="text-slate-500 text-xs">{me?.isAdmin ? 'Viewing as guest' : 'Subcontractor'}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <AdminPanelButton isAdmin={!!me?.isAdmin} />
          <button onClick={logout} aria-label="Sign out" className="p-2 rounded-lg text-slate-400 hover:text-red-400 cursor-pointer"><LogOut className="w-5 h-5" /></button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-sky-400" /> My jobs
          </h1>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        {/* Quick links: invoices open, admin-only areas visibly locked */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Link href="/admin/invoices" className="rounded-xl border border-white/10 bg-navy-800 p-4 flex items-center gap-3 hover:border-sky-400/30 transition-colors cursor-pointer">
            <FileText className="w-5 h-5 text-sky-400 flex-shrink-0" />
            <span className="text-white text-sm font-semibold">My invoices</span>
          </Link>
          {LOCKED.map(({ label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => toast.error('Access denied — admin only')}
              title="Admin only"
              className="rounded-xl border border-white/5 bg-navy-800/50 p-4 flex items-center gap-3 opacity-50 cursor-not-allowed text-left"
            >
              <Icon className="w-5 h-5 text-slate-600 flex-shrink-0" />
              <span className="text-slate-500 text-sm font-semibold min-w-0 truncate">{label}</span>
              <Lock className="w-3.5 h-3.5 text-slate-600 ml-auto flex-shrink-0" />
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-32 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No jobs assigned to you yet.
          </div>
        ) : (
          <div className="space-y-6">
            {open.length > 0 && (
              <section className="space-y-3">
                {open.map(b => (
                  <JobCard key={b.id} b={b} busy={busyId === b.id} onStatus={setStatus} onPaid={togglePaid} />
                ))}
              </section>
            )}
            {done.length > 0 && (
              <section>
                <h2 className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Finished</h2>
                <div className="space-y-3">
                  {done.map(b => (
                    <JobCard key={b.id} b={b} busy={busyId === b.id} onStatus={setStatus} onPaid={togglePaid} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {showAdd && <AddBookingModal onClose={() => setShowAdd(false)} onCreated={b => setJobs(j => [b, ...j])} />}
    </div>
  );
}

function JobCard({ b, busy, onStatus, onPaid }: {
  b: Booking; busy: boolean;
  onStatus: (b: Booking, s: BookingStatus) => void;
  onPaid: (b: Booking) => void;
}) {
  const where = [b.address, b.suburb].filter(Boolean).join(', ');
  return (
    <div className={`rounded-xl border p-4 transition-opacity ${busy ? 'opacity-60' : ''} ${b.status === 'completed' ? 'border-emerald-400/20 bg-navy-800/60' : 'border-white/10 bg-navy-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-white font-semibold truncate">{b.name}</div>
          <div className="text-slate-400 text-xs mt-0.5">{serviceText(b.service)}</div>
        </div>
        <span className={`flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold badge-${b.status}`}>
          {STATUS_LABEL[b.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
        {b.phone && <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1.5 text-sky-400"><PhoneIcon className="w-3.5 h-3.5" /> {b.phone}</a>}
        {where && <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {where}</span>}
        {(b.preferredDate || b.preferredTime) && (
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" /> {[b.preferredDate, b.preferredTime].filter(Boolean).join(' ')}</span>
        )}
        {money(b.quoteAmount) && <span className="text-violet-300 font-semibold">{money(b.quoteAmount)}</span>}
      </div>

      {b.notes && (
        <div className="mt-2 text-slate-400 text-xs flex items-start gap-1.5">
          <StickyNote className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-500" /> {b.notes}
        </div>
      )}

      {/* Status controls */}
      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2">
        <select
          value={b.status}
          disabled={busy}
          onChange={e => onStatus(b, e.target.value as BookingStatus)}
          className={`flex-1 text-sm font-semibold rounded-lg px-3 py-2.5 cursor-pointer bg-transparent border focus:outline-none badge-${b.status}`}
        >
          {STATUS_KEYS.map(s => <option key={s} value={s} className="bg-navy-800 text-white">{STATUS_LABEL[s]}</option>)}
        </select>
        <button
          onClick={() => onPaid(b)}
          disabled={busy}
          className={`inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-semibold cursor-pointer touch-manipulation ${b.paid ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300' : 'bg-red-500/15 border-red-400/40 text-red-300'}`}
        >
          <Wallet className="w-3.5 h-3.5" /> {b.paid ? 'Paid' : 'Unpaid'}
        </button>
      </div>
    </div>
  );
}
