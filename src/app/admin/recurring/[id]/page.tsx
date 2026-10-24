'use client';

// A recurring customer's profile: their details and plan, every job linked to
// them, and "New job" to book the next one straight onto the profile.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Repeat, Plus, Check, X, Trash2, MapPin, Phone, Mail, CalendarDays, CalendarPlus, Edit3, StickyNote, User, DollarSign, ChevronRight,
} from 'lucide-react';
import type { RecurringJob, Booking } from '@/lib/db';
import { frequencyLabel, discountFor, PLAN_DISCOUNT_MIN } from '@/lib/recurring';
import PlanPicker, { planPayload, type PlanValue } from '@/components/admin/PlanPicker';
import { AddressLink } from '@/components/AddressLink';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

const SERVICE_OPTIONS = [
  { v: 'window-washing', l: 'Window Washing' },
  { v: 'pressure-washing', l: 'Pressure Washing' },
  { v: 'flyscreen-repair', l: 'Flyscreen Repair' },
  { v: 'solar-panel-cleaning', l: 'Solar Panel Cleaning' },
  { v: 'other', l: 'Other' },
];
const SERVICE_LABELS: Record<string, string> = { ...Object.fromEntries(SERVICE_OPTIONS.map(o => [o.v, o.l])), both: 'Both Services' };
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';
const STATUS_LABEL: Record<string, string> = { uncontacted: 'Uncontacted', contacted: 'Contacted', 'quote-booked': 'Quote Booked', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead' };
const money = (n?: number | null) => typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })}` : '';
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const jobWhen = (b: Booking) => b.scheduledAt
  ? new Date(b.scheduledAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : b.preferredDate ? dayLabel(b.preferredDate) : `Added ${new Date(b.createdAt).toLocaleDateString('en-AU')}`;
const priceNum = (s: string) => { const n = Number(s.replace(/[^0-9.]/g, '')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null; };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}
function Row({ icon: Icon, label, children }: { icon: React.FC<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
      <Icon className="w-4 h-4 text-amber-300 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-slate-500 text-xs">{label}</div>
        <div className="text-white text-sm mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

type ProfileForm = {
  name: string; phone: string; email: string; address: string; suburb: string; service: string;
  nextDate: string; preferredTime: string; visitPrice: string; notes: string; plan: PlanValue;
};
const toForm = (j: RecurringJob): ProfileForm => ({
  name: j.name, phone: j.phone, email: j.email, address: j.address, suburb: j.suburb, service: j.service,
  nextDate: j.nextDate, preferredTime: j.preferredTime, visitPrice: j.visitPrice != null ? String(j.visitPrice) : '', notes: j.notes,
  plan: {
    frequency: j.frequency,
    customInterval: j.customInterval != null ? String(j.customInterval) : '',
    customIntervalUnit: j.customIntervalUnit,
    discount: j.discount != null ? String(j.discount) : '',
  },
});

export default function RecurringProfilePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<RecurringJob | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [from, setFrom] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  // New job
  const [showNew, setShowNew] = useState(false);
  const [nj, setNj] = useState({ date: '', time: '09:00', price: '', notes: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('from');
    if (f && f.startsWith('/admin')) setFrom(f);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/recurring/${id}`);
    if (res.status === 401) { router.push('/admin'); return; }
    if (!res.ok) { setState('notfound'); return; }
    const data: { job: RecurringJob; bookings: Booking[] } = await res.json();
    setJob(data.job);
    setBookings(data.bookings);
    setState('ok');
  }, [id, router]);
  useEffect(() => { load().catch(() => setState('notfound')); }, [load]);

  const goBack = () => router.push(from ?? '/admin/recurring');
  const selfHref = `/admin/recurring/${id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;

  const patch = async (updates: Partial<RecurringJob>) => {
    const res = await fetch(`/api/admin/recurring/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
    const saved: RecurringJob = await res.json();
    setJob(saved);
    return saved;
  };

  const startEdit = () => { if (job) { setForm(toForm(job)); setEdit(true); } };
  const saveEdit = async () => {
    if (!form) return;
    if (!form.name.trim()) { toast.error('Name is needed'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.nextDate)) { toast.error('Pick the next visit date'); return; }
    const plan = planPayload(form.plan);
    if (!plan) { toast.error('Type how many for the custom timeframe'); return; }
    setSaving(true);
    try {
      await patch({
        name: form.name.trim(), phone: form.phone, email: form.email, address: form.address, suburb: form.suburb,
        service: form.service || 'window-washing', nextDate: form.nextDate, preferredTime: form.preferredTime,
        visitPrice: priceNum(form.visitPrice), notes: form.notes, ...plan,
      });
      toast.success('Profile saved');
      setEdit(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Save failed'); }
    finally { setSaving(false); }
  };

  const toggleActive = async () => {
    if (!job) return;
    try { const s = await patch({ active: !job.active }); toast.success(s.active ? 'Auto-booking resumed' : 'Auto-booking paused'); }
    catch { toast.error('Update failed'); }
  };

  const remove = async () => {
    if (!job || !window.confirm(`Delete ${job.name}'s recurring profile? Their bookings stay, they just won't be linked any more.`)) return;
    const res = await fetch(`/api/admin/recurring/${id}`, { method: 'DELETE' });
    if (res.ok) { toast.success('Profile deleted'); router.push('/admin/recurring'); }
    else toast.error('Delete failed');
  };

  const openNew = () => {
    if (!job) return;
    setNj({ date: job.nextDate, time: '09:00', price: job.visitPrice != null ? String(job.visitPrice) : '', notes: job.notes });
    setShowNew(true);
  };
  const createJob = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nj.date)) { toast.error('Pick a date for the job'); return; }
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/recurring/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-job',
          date: nj.date,
          scheduledAt: nj.time ? new Date(`${nj.date}T${nj.time}`).toISOString() : null,
          price: priceNum(nj.price),
          notes: nj.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create job');
      const data: { booking: Booking; job: RecurringJob } = await res.json();
      setJob(data.job);
      setBookings(bs => [data.booking, ...bs]);
      setShowNew(false);
      toast.success('Job created and added to the calendar');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not create job'); }
    finally { setCreating(false); }
  };

  const bookNext = async () => {
    try {
      const res = await fetch(`/api/admin/recurring/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate' }) });
      if (!res.ok) throw new Error();
      const data: { booking: Booking; job: RecurringJob } = await res.json();
      setJob(data.job);
      setBookings(bs => [data.booking, ...bs]);
      toast.success('Next visit added to the calendar');
    } catch { toast.error('Could not book the next visit'); }
  };

  // History numbers
  const active = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'cold');
  const done = bookings.filter(b => b.status === 'completed');
  const spent = bookings.filter(b => b.paid).reduce((s, b) => s + (b.quoteAmount ?? 0), 0);
  const njPrice = priceNum(nj.price);
  const njOff = discountFor(njPrice, job?.discount);

  const selectedServices = form?.service ? form.service.split(',') : [];
  const toggleService = (v: string) => setForm(f => {
    if (!f) return f;
    const list = f.service ? f.service.split(',') : [];
    return { ...f, service: (list.includes(v) ? list.filter(x => x !== v) : [...list, v]).join(',') };
  });
  const setF = (k: keyof Omit<ProfileForm, 'plan'>, v: string) => setForm(f => f ? { ...f, [k]: v } : f);

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="recurring" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
        >
          {edit ? (
            <button onClick={() => setEdit(false)} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer">
              <X className="w-5 h-5" /> Cancel
            </button>
          ) : (
            <button onClick={goBack} className="inline-flex items-center gap-2 -ml-2 px-2 py-2 rounded-lg text-slate-300 hover:text-white active:bg-white/10 text-sm cursor-pointer transition-colors touch-manipulation">
              <ArrowLeft className="w-5 h-5" /> Back
            </button>
          )}
          {state === 'ok' && !edit && (
            <button onClick={startEdit} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:border-amber-400/40 text-sm cursor-pointer">
              <Edit3 className="w-4 h-4" /> Edit
            </button>
          )}
        </header>

        <main className="max-w-xl w-full mx-auto px-4 py-6 pb-28">
          {state === 'loading' && (
            <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}</div>
          )}
          {state === 'notfound' && (
            <div className="text-center py-20 text-slate-500">
              Recurring customer not found. <Link href="/admin/recurring" className="text-sky-400">All recurring customers</Link>
            </div>
          )}

          {/* ── READ MODE ── */}
          {state === 'ok' && job && !edit && (
            <>
              <div className="mb-5">
                <div className="text-amber-300/80 text-xs font-semibold uppercase tracking-wide mb-1">Recurring customer</div>
                <h1 className="font-display text-2xl font-bold text-amber-300 break-words flex items-center gap-2">
                  <Repeat className="w-6 h-6 flex-shrink-0" /> {job.name}
                </h1>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-400/15 text-amber-200 border border-amber-400/25">{frequencyLabel(job)}</span>
                  {job.discount ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-400/15 text-emerald-300 border border-emerald-400/20">${job.discount} off jobs over ${PLAN_DISCOUNT_MIN}</span>
                  ) : null}
                  {!job.active && <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-white/5 text-slate-400 border border-white/10">Auto-booking paused</span>}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-5">
                {[
                  { l: 'Jobs', v: String(active.length) },
                  { l: 'Completed', v: String(done.length) },
                  { l: 'Paid total', v: money(spent) || '$0' },
                ].map(s => (
                  <div key={s.l} className="rounded-lg border border-white/10 bg-navy-800 px-3 py-2.5">
                    <div className="text-slate-500 text-[11px]">{s.l}</div>
                    <div className="text-white font-bold text-lg leading-tight">{s.v}</div>
                  </div>
                ))}
              </div>

              <button onClick={openNew} className="mb-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-900 text-sm font-bold transition-colors cursor-pointer touch-manipulation">
                <Plus className="w-4 h-4" /> New job for {job.name.split(' ')[0]}
              </button>
              <button onClick={bookNext} className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15 text-sm font-semibold transition-colors cursor-pointer touch-manipulation">
                <CalendarPlus className="w-4 h-4" /> Book next visit ({dayLabel(job.nextDate)})
              </button>

              <div className="rounded-lg border border-white/10 bg-navy-800 px-4 mb-6">
                <Row icon={CalendarDays} label="Next visit due">{dayLabel(job.nextDate)}{job.preferredTime ? ` · ${job.preferredTime}` : ''}</Row>
                {job.phone && <Row icon={Phone} label="Phone"><a href={`tel:${job.phone}`} className="text-sky-400">{job.phone}</a></Row>}
                {job.email && <Row icon={Mail} label="Email"><a href={`mailto:${job.email}`} className="text-sky-400 break-all">{job.email}</a></Row>}
                {(job.address || job.suburb) && <Row icon={MapPin} label="Address"><AddressLink address={[job.address, job.suburb].filter(Boolean).join(', ')} /></Row>}
                <Row icon={User} label="Services">{serviceText(job.service)}{job.propertyType === 'commercial' ? ' · Commercial' : ''}</Row>
                {job.visitPrice != null && (
                  <Row icon={DollarSign} label="Usual price per clean">
                    {money(job.visitPrice)}
                    {discountFor(job.visitPrice, job.discount) > 0 && <span className="text-emerald-300"> → {money(job.visitPrice - discountFor(job.visitPrice, job.discount))} with plan discount</span>}
                  </Row>
                )}
                {job.notes && <Row icon={StickyNote} label="Notes"><span className="whitespace-pre-wrap">{job.notes}</span></Row>}
              </div>

              <h2 className="font-display text-lg font-bold text-white mb-3">Jobs</h2>
              {bookings.length === 0 ? (
                <div className="rounded-lg border border-white/10 bg-navy-800 p-6 text-center text-slate-500 text-sm">No jobs linked yet.</div>
              ) : (
                <ul className="space-y-2">
                  {bookings.map(b => (
                    <li key={b.id}>
                      <Link href={`/admin/bookings/${b.id}?from=${encodeURIComponent(selfHref)}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-navy-800 p-3 hover:border-amber-400/30 hover:bg-white/[0.03] transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="text-white text-sm font-medium truncate">{jobWhen(b)}</div>
                          <div className="text-slate-500 text-xs truncate">
                            {serviceText(b.service)}
                            {typeof b.quoteAmount === 'number' && b.quoteAmount > 0 ? ` · ${money(b.quoteAmount)}` : ''}
                            {b.paid ? ' · Paid' : ''}
                          </div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold flex-shrink-0 badge-${b.status}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                        <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-8 pt-4 border-t border-white/5 flex items-center justify-between">
                <button onClick={toggleActive} className={`text-xs font-semibold cursor-pointer ${job.active ? 'text-slate-400 hover:text-amber-300' : 'text-emerald-400'}`}>
                  {job.active ? 'Pause auto-booking' : 'Resume auto-booking'}
                </button>
                <button onClick={remove} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 cursor-pointer">
                  <Trash2 className="w-4 h-4" /> Delete profile
                </button>
              </div>
            </>
          )}

          {/* ── EDIT MODE ── */}
          {state === 'ok' && form && edit && (
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div><FieldLabel>Name *</FieldLabel><input className="form-input" value={form.name} onChange={e => setF('name', e.target.value)} /></div>
                <div><FieldLabel>Phone</FieldLabel><input className="form-input" type="tel" value={form.phone} onChange={e => setF('phone', e.target.value)} /></div>
                <div className="sm:col-span-2"><FieldLabel>Address</FieldLabel><input className="form-input" value={form.address} onChange={e => setF('address', e.target.value)} /></div>
                <div><FieldLabel>Suburb</FieldLabel><input className="form-input" value={form.suburb} onChange={e => setF('suburb', e.target.value)} /></div>
                <div><FieldLabel>Email</FieldLabel><input className="form-input" type="email" value={form.email} onChange={e => setF('email', e.target.value)} /></div>
              </div>
              <div>
                <FieldLabel>Services</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_OPTIONS.map(o => (
                    <button key={o.v} type="button" onClick={() => toggleService(o.v)} className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${selectedServices.includes(o.v) ? 'border-amber-400 bg-amber-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <FieldLabel>How often</FieldLabel>
                <PlanPicker value={form.plan} onChange={plan => setForm(f => f ? { ...f, plan } : f)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><FieldLabel>Next visit due</FieldLabel><input className="form-input" type="date" value={form.nextDate} onChange={e => setF('nextDate', e.target.value)} /></div>
                <div><FieldLabel>Preferred time</FieldLabel><input className="form-input" placeholder="e.g. Morning" value={form.preferredTime} onChange={e => setF('preferredTime', e.target.value)} /></div>
                <div className="col-span-2">
                  <FieldLabel>Usual price per clean, before discount ($)</FieldLabel>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input className="form-input pl-8" inputMode="decimal" value={form.visitPrice} onChange={e => setF('visitPrice', e.target.value)} />
                  </div>
                </div>
              </div>
              <div><FieldLabel>Notes</FieldLabel><textarea className="form-input resize-none" rows={3} placeholder="Access notes, standing instructions" value={form.notes} onChange={e => setF('notes', e.target.value)} /></div>
              <button onClick={saveEdit} disabled={saving} className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
                {saving ? <div className="w-4 h-4 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Save profile
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ── New job ── */}
      {showNew && job && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowNew(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-amber-300" /> New job for {job.name}</h3>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
              <div className="grid grid-cols-2 gap-3">
                <div><FieldLabel>Date *</FieldLabel><input className="form-input" type="date" value={nj.date} onChange={e => setNj(s => ({ ...s, date: e.target.value }))} /></div>
                <div><FieldLabel>Start time</FieldLabel><input className="form-input" type="time" value={nj.time} onChange={e => setNj(s => ({ ...s, time: e.target.value }))} /></div>
              </div>
              <div>
                <FieldLabel>Price before discount ($)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input className="form-input pl-8" inputMode="decimal" placeholder="Leave blank to quote later" value={nj.price} onChange={e => setNj(s => ({ ...s, price: e.target.value }))} />
                </div>
                {njPrice != null && (
                  <p className="text-xs mt-1.5">
                    {njOff > 0
                      ? <span className="text-emerald-300">{money(njPrice)} − {money(njOff)} plan discount = <b>{money(njPrice - njOff)}</b></span>
                      : <span className="text-slate-500">{job.discount ? `Plan discount only applies over $${PLAN_DISCOUNT_MIN}.` : 'No plan discount on this profile.'} Price: {money(njPrice)}</span>}
                  </p>
                )}
              </div>
              <div><FieldLabel>Notes for the job</FieldLabel><textarea className="form-input resize-none" rows={2} value={nj.notes} onChange={e => setNj(s => ({ ...s, notes: e.target.value }))} /></div>
              <p className="text-slate-500 text-xs">Uses {job.name.split(' ')[0]}&apos;s details from this profile, goes on the calendar as Confirmed, and links back here.</p>
              <button onClick={createJob} disabled={creating} className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
                {creating ? <div className="w-4 h-4 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Create job
              </button>
            </div>
          </div>
        </div>
      )}

      <AdminMobileNav active="recurring" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="recurring" items={navItems} />
    </div>
  );
}
