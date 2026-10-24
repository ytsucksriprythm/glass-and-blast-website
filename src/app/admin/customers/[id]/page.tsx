'use client';

// A customer's page: everything they've booked, and "New job" to book them in
// again as a one-off. Not a plan — for that, "Make recurring customer" turns
// them into a recurring profile (/admin/recurring/[id]). [id] is any of their
// booking ids; the page gathers the rest by phone/email (see getCustomerBookings).
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Repeat, Plus, Check, X, MapPin, Phone, Mail, User, ChevronRight } from 'lucide-react';
import type { Booking, RecurringJob } from '@/lib/db';
import { frequencyLabel, profileHref } from '@/lib/recurring';
import PlanPicker, { DEFAULT_PLAN, planPayload, type PlanValue } from '@/components/admin/PlanPicker';
import { AddressLink } from '@/components/AddressLink';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Washing', 'pressure-washing': 'Pressure Washing', both: 'Both Services',
  'flyscreen-repair': 'Flyscreen Repair', 'solar-panel-cleaning': 'Solar Panel Cleaning', other: 'Other',
};
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';
const STATUS_LABEL: Record<string, string> = { uncontacted: 'Uncontacted', contacted: 'Contacted', 'quote-booked': 'Quote Booked', quoted: 'Quoted', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', cold: 'Cold Lead' };
const money = (n?: number | null) => typeof n === 'number' ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })}` : '';
const jobWhen = (b: Booking) => b.scheduledAt
  ? new Date(b.scheduledAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : b.preferredDate ? `Wanted ${b.preferredDate}` : `Added ${new Date(b.createdAt).toLocaleDateString('en-AU')}`;
const priceNum = (s: string) => { const n = Number(s.replace(/[^0-9.]/g, '')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null; };
const todayYmd = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}
function Row({ icon: Icon, label, children }: { icon: React.FC<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
      <Icon className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-slate-500 text-xs">{label}</div>
        <div className="text-white text-sm mt-0.5 break-words">{children}</div>
      </div>
    </div>
  );
}

export default function CustomerPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [recurring, setRecurring] = useState<RecurringJob | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [from, setFrom] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [nj, setNj] = useState({ date: '', time: '09:00', price: '', notes: '' });
  const [creating, setCreating] = useState(false);

  const [showRecurring, setShowRecurring] = useState(false);
  const [plan, setPlan] = useState<PlanValue>(DEFAULT_PLAN);
  const [planPrice, setPlanPrice] = useState('');
  const [makingRecurring, setMakingRecurring] = useState(false);

  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('from');
    if (f && f.startsWith('/admin')) setFrom(f);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/customers/${id}`);
    if (res.status === 401) { router.push('/admin'); return; }
    if (!res.ok) { setState('notfound'); return; }
    const data: { bookings: Booking[]; recurring: RecurringJob | null } = await res.json();
    setBookings(data.bookings);
    setRecurring(data.recurring);
    setState('ok');
  }, [id, router]);
  useEffect(() => { load().catch(() => setState('notfound')); }, [load]);

  const latest = bookings[0];
  const lastPrice = bookings.find(b => typeof b.quoteAmount === 'number' && b.quoteAmount > 0)?.quoteAmount ?? null;
  const selfHref = `/admin/customers/${id}${from ? `?from=${encodeURIComponent(from)}` : ''}`;
  const goBack = () => {
    if (from) router.push(from);
    else if (window.history.length > 1) router.back();
    else router.push('/admin/dashboard');
  };

  const openNew = () => {
    setNj({ date: todayYmd(), time: '09:00', price: lastPrice != null ? String(lastPrice) : '', notes: '' });
    setShowNew(true);
  };
  const createJob = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nj.date)) { toast.error('Pick a date for the job'); return; }
    setCreating(true);
    try {
      const res = await fetch(`/api/admin/customers/${id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: nj.date,
          scheduledAt: nj.time ? new Date(`${nj.date}T${nj.time}`).toISOString() : null,
          price: priceNum(nj.price),
          notes: nj.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create job');
      const booking: Booking = await res.json();
      setBookings(bs => [booking, ...bs]);
      setShowNew(false);
      toast.success('Job created and added to the calendar');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not create job'); }
    finally { setCreating(false); }
  };

  const openRecurring = () => { setPlan(DEFAULT_PLAN); setPlanPrice(lastPrice != null ? String(lastPrice) : ''); setShowRecurring(true); };
  const makeRecurring = async () => {
    if (!latest) return;
    const payload = planPayload(plan);
    if (!payload) { toast.error('Type how many for the custom timeframe'); return; }
    setMakingRecurring(true);
    try {
      const res = await fetch('/api/admin/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, fromBookingId: latest.id, visitPrice: priceNum(planPrice) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not create profile');
      const { job } = await res.json();
      toast.success('Recurring profile created');
      router.push(profileHref(job.id, selfHref));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create profile');
      setMakingRecurring(false);
    }
  };

  const live = bookings.filter(b => b.status !== 'cancelled' && b.status !== 'cold');
  const done = bookings.filter(b => b.status === 'completed');
  const spent = bookings.filter(b => b.paid).reduce((s, b) => s + (b.quoteAmount ?? 0), 0);

  return (
    <div className="min-h-[100svh] bg-navy-900">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={goBack} className="inline-flex items-center gap-2 -ml-2 px-2 py-2 rounded-lg text-slate-300 hover:text-white active:bg-white/10 text-sm cursor-pointer transition-colors touch-manipulation">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <Link href="/admin/dashboard" className="text-slate-500 text-sm hover:text-sky-400">Dashboard</Link>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 pb-28">
        {state === 'loading' && (
          <div className="space-y-3">{[0, 1, 2, 3].map(i => <div key={i} className="h-14 bg-white/5 rounded-lg animate-pulse" />)}</div>
        )}
        {state === 'notfound' && (
          <div className="text-center py-20 text-slate-500">
            Customer not found. <Link href="/admin/dashboard" className="text-sky-400">Back to dashboard</Link>
          </div>
        )}

        {state === 'ok' && latest && (
          <>
            <div className="mb-5">
              <div className="text-slate-500 text-xs font-semibold uppercase tracking-wide mb-1">Customer</div>
              <h1 className="font-display text-2xl font-bold text-white break-words">{latest.name}</h1>
            </div>

            {recurring ? (
              <Link href={profileHref(recurring.id, selfHref)} className="mb-5 flex items-center gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 hover:bg-amber-400/15 transition-colors">
                <Repeat className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <span className="flex-1 text-sm">
                  <span className="block text-amber-200 font-semibold">Recurring customer · {frequencyLabel(recurring)}</span>
                  <span className="block text-amber-200/70 text-xs">Open their recurring profile</span>
                </span>
                <ChevronRight className="w-4 h-4 text-amber-300/70" />
              </Link>
            ) : null}

            <div className="grid grid-cols-3 gap-2 mb-5">
              {[
                { l: 'Jobs', v: String(live.length) },
                { l: 'Completed', v: String(done.length) },
                { l: 'Paid total', v: money(spent) || '$0' },
              ].map(s => (
                <div key={s.l} className="rounded-lg border border-white/10 bg-navy-800 px-3 py-2.5">
                  <div className="text-slate-500 text-[11px]">{s.l}</div>
                  <div className="text-white font-bold text-lg leading-tight">{s.v}</div>
                </div>
              ))}
            </div>

            <button onClick={openNew} className="mb-3 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-bold transition-colors cursor-pointer touch-manipulation">
              <Plus className="w-4 h-4" /> New job for {latest.name.split(' ')[0]}
            </button>
            {!recurring && (
              <button onClick={openRecurring} className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/15 text-sm font-semibold transition-colors cursor-pointer touch-manipulation">
                <Repeat className="w-4 h-4" /> Make recurring customer
              </button>
            )}

            <div className="rounded-lg border border-white/10 bg-navy-800 px-4 mb-6 mt-2">
              {latest.phone && <Row icon={Phone} label="Phone"><a href={`tel:${latest.phone}`} className="text-sky-400">{latest.phone}</a></Row>}
              {latest.email && <Row icon={Mail} label="Email"><a href={`mailto:${latest.email}`} className="text-sky-400 break-all">{latest.email}</a></Row>}
              {(latest.address || latest.suburb) && <Row icon={MapPin} label="Address"><AddressLink address={[latest.address, latest.suburb].filter(Boolean).join(', ')} /></Row>}
              <Row icon={User} label="Last service">{serviceText(latest.service)}{latest.propertyType === 'commercial' ? ' · Commercial' : ''}</Row>
            </div>

            <h2 className="font-display text-lg font-bold text-white mb-3">Jobs</h2>
            <ul className="space-y-2">
              {bookings.map(b => (
                <li key={b.id}>
                  <Link href={`/admin/bookings/${b.id}?from=${encodeURIComponent(selfHref)}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-navy-800 p-3 hover:border-sky-400/30 hover:bg-white/[0.03] transition-colors">
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
          </>
        )}
      </main>

      {/* ── New one-off job ── */}
      {showNew && latest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowNew(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-sky-400" /> New job for {latest.name}</h3>
              <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
              <div className="grid grid-cols-2 gap-3">
                <div><FieldLabel>Date *</FieldLabel><input className="form-input" type="date" value={nj.date} onChange={e => setNj(s => ({ ...s, date: e.target.value }))} /></div>
                <div><FieldLabel>Start time</FieldLabel><input className="form-input" type="time" value={nj.time} onChange={e => setNj(s => ({ ...s, time: e.target.value }))} /></div>
              </div>
              <div>
                <FieldLabel>Price ($)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input className="form-input pl-8" inputMode="decimal" placeholder="Leave blank to quote later" value={nj.price} onChange={e => setNj(s => ({ ...s, price: e.target.value }))} />
                </div>
              </div>
              <div><FieldLabel>Notes for the job</FieldLabel><textarea className="form-input resize-none" rows={2} value={nj.notes} onChange={e => setNj(s => ({ ...s, notes: e.target.value }))} /></div>
              <p className="text-slate-500 text-xs">One-off job with {latest.name.split(' ')[0]}&apos;s details, Confirmed on the calendar. Nothing repeats.</p>
              <button onClick={createJob} disabled={creating} className="w-full py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
                {creating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Create job
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Make recurring ── */}
      {showRecurring && latest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowRecurring(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><Repeat className="w-4 h-4 text-amber-300" /> Make {latest.name} a recurring customer</h3>
              <button onClick={() => setShowRecurring(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-4 space-y-4" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
              <div><FieldLabel>How often?</FieldLabel><PlanPicker value={plan} onChange={setPlan} /></div>
              <div>
                <FieldLabel>Usual price per clean, before discount ($)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input className="form-input pl-8" inputMode="decimal" placeholder="e.g. 280" value={planPrice} onChange={e => setPlanPrice(e.target.value)} />
                </div>
              </div>
              <button onClick={makeRecurring} disabled={makingRecurring} className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
                {makingRecurring ? <div className="w-4 h-4 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Create recurring profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
