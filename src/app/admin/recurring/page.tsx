'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Repeat, Plus, Check, X, Trash2, Play, MapPin, Phone as PhoneIcon, CalendarDays, CalendarPlus,
} from 'lucide-react';
import type { RecurringJob, RecurringFrequency, BillingCycle, Booking } from '@/lib/db';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

const SERVICE_OPTIONS = [
  { v: 'window-washing', l: 'Window Washing' },
  { v: 'pressure-washing', l: 'Pressure Washing' },
  { v: 'flyscreen-repair', l: 'Flyscreen Repair' },
  { v: 'solar-panel-cleaning', l: 'Solar Panel Cleaning' },
  { v: 'other', l: 'Other' },
];
const SERVICE_LABELS: Record<string, string> = Object.fromEntries(SERVICE_OPTIONS.map(o => [o.v, o.l]));
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || '-';

const FREQ_LABEL: Record<RecurringFrequency, string> = {
  weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly', quarterly: 'Quarterly', biannual: 'Twice a year', custom: 'Custom',
};
const freqBadge = (j: RecurringJob) => j.frequency === 'custom' && j.customIntervalWeeks ? `Every ${j.customIntervalWeeks}w` : FREQ_LABEL[j.frequency];

const BILLING_LABEL: Record<BillingCycle, string> = { per_visit: 'Every visit', monthly: 'Every month', custom: 'Custom' };
const billingBadge = (j: RecurringJob) => j.billingCycle === 'custom' && j.customBillingCycle ? j.customBillingCycle : BILLING_LABEL[j.billingCycle];

type PlanForm = {
  name: string; phone: string; email: string; address: string; suburb: string;
  service: string; frequency: RecurringFrequency; customIntervalWeeks: string; nextDate: string;
  preferredTime: string; notes: string; visitPrice: string;
  billingCycle: BillingCycle; customBillingCycle: string;
};
const EMPTY: PlanForm = {
  name: '', phone: '', email: '', address: '', suburb: '',
  service: 'window-washing', frequency: 'quarterly', customIntervalWeeks: '', nextDate: '',
  preferredTime: '', notes: '', visitPrice: '',
  billingCycle: 'per_visit', customBillingCycle: '',
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}

function RecurringInner() {
  const router = useRouter();
  const search = useSearchParams();
  const prefillId = search.get('prefill');

  const [jobs, setJobs] = useState<RecurringJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  const set = (k: keyof PlanForm, v: string) => setForm(f => ({ ...f, [k]: v }));
  const toggleService = (v: string) => setForm(f => {
    const list = f.service ? f.service.split(',') : [];
    const next = list.includes(v) ? list.filter(x => x !== v) : [...list, v];
    return { ...f, service: next.join(',') };
  });
  const selectedServices = form.service ? form.service.split(',') : [];

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/recurring');
        if (res.status === 401) { router.push('/admin'); return; }
        if (res.ok) setJobs(await res.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  // Arriving from a booking: prefill the form with that customer's details.
  useEffect(() => {
    if (!prefillId) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/bookings/${prefillId}`);
        if (!res.ok) return;
        const b: Booking = await res.json();
        setForm({
          ...EMPTY,
          name: b.name, phone: b.phone, email: b.email,
          address: b.address, suburb: b.suburb,
          service: b.service || 'window-washing',
          preferredTime: b.preferredTime,
        });
        setShowForm(true);
      } catch { /* fall through to a blank form */ }
    })();
  }, [prefillId]);

  const openAdd = () => { setForm(EMPTY); setEditId(null); setShowForm(true); };
  const openEdit = (j: RecurringJob) => {
    setForm({
      name: j.name, phone: j.phone, email: j.email, address: j.address, suburb: j.suburb,
      service: j.service, frequency: j.frequency, customIntervalWeeks: j.customIntervalWeeks != null ? String(j.customIntervalWeeks) : '', nextDate: j.nextDate,
      preferredTime: j.preferredTime, notes: j.notes,
      visitPrice: j.visitPrice != null ? String(j.visitPrice) : '',
      billingCycle: j.billingCycle, customBillingCycle: j.customBillingCycle ?? '',
    });
    setEditId(j.id);
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditId(null); setForm(EMPTY); };

  const pickFrequency = (freq: RecurringFrequency) => setForm(f => ({ ...f, frequency: freq }));
  const pickBilling = (cycle: BillingCycle) => setForm(f => ({ ...f, billingCycle: cycle }));

  const save = async () => {
    if (!form.name || !form.service || !form.nextDate) { toast.error('Name, service and next visit date are needed'); return; }
    if (form.frequency === 'custom' && (!form.customIntervalWeeks.trim() || Number(form.customIntervalWeeks) < 1)) {
      toast.error('Custom cadence needs a number of weeks (1 or more)');
      return;
    }
    if (form.billingCycle === 'custom' && !form.customBillingCycle.trim()) {
      toast.error('Describe the custom billing cycle');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        customIntervalWeeks: form.frequency === 'custom' && form.customIntervalWeeks.trim() !== '' ? Number(form.customIntervalWeeks) : null,
        visitPrice: form.visitPrice.trim() === '' ? null : Number(form.visitPrice.replace(/[^0-9.]/g, '')),
        customBillingCycle: form.billingCycle === 'custom' ? form.customBillingCycle.trim() : null,
      };
      const res = editId
        ? await fetch(`/api/admin/recurring/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/admin/recurring', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      const saved: RecurringJob = await res.json();
      setJobs(js => editId ? js.map(j => j.id === editId ? saved : j) : [...js, saved].sort((a, b) => a.nextDate.localeCompare(b.nextDate)));
      toast.success(editId ? 'Plan updated' : 'Plan created');
      closeForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const toggleActive = async (j: RecurringJob) => {
    const res = await fetch(`/api/admin/recurring/${j.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !j.active }) });
    if (res.ok) {
      const saved: RecurringJob = await res.json();
      setJobs(js => js.map(x => x.id === j.id ? saved : x));
      toast.success(saved.active ? 'Plan resumed' : 'Plan paused');
    } else toast.error('Update failed');
  };

  const remove = async (j: RecurringJob) => {
    if (!window.confirm(`Delete the ${FREQ_LABEL[j.frequency].toLowerCase()} plan for ${j.name}?`)) return;
    const res = await fetch(`/api/admin/recurring/${j.id}`, { method: 'DELETE' });
    if (res.ok) { setJobs(js => js.filter(x => x.id !== j.id)); toast.success('Plan deleted'); }
    else toast.error('Delete failed');
  };

  // Manual trigger of the daily cron — books in anything due today.
  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/cron/recurring');
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(data.created > 0 ? `${data.created} booking${data.created > 1 ? 's' : ''} created` : 'Nothing due yet');
      if (data.created > 0) {
        const jr = await fetch('/api/admin/recurring');
        if (jr.ok) setJobs(await jr.json());
      }
    } catch { toast.error('Run failed'); }
    finally { setRunning(false); }
  };

  // Roll a single plan forward now: creates a confirmed, calendar-scheduled
  // booking for its next visit and advances the plan a cycle.
  const generateNext = async (j: RecurringJob) => {
    try {
      const res = await fetch(`/api/admin/recurring/${j.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate' }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setJobs(js => js.map(x => x.id === j.id ? data.job : x));
      toast.success('Next visit added to the calendar');
    } catch { toast.error('Could not generate visit'); }
  };

  const dueSoon = (d: string) => d <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="recurring" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push('/admin/dashboard')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer lg:hidden">
          <ArrowLeft className="w-5 h-5" /> Dashboard
        </button>
        <button onClick={runNow} disabled={running} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:border-sky-400/40 text-sm cursor-pointer disabled:opacity-50">
          {running ? <div className="w-4 h-4 border-2 border-white/20 border-t-sky-400 rounded-full animate-spin" /> : <Play className="w-4 h-4" />} Book in due jobs
        </button>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 pb-28">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <Repeat className="w-6 h-6 text-sky-400" /> Recurring plans
            </h1>
            <p className="text-slate-500 text-xs mt-1">Each plan books itself in automatically when the next visit comes due.</p>
          </div>
        </div>

        {!showForm && (
          <button onClick={openAdd} className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold transition-colors cursor-pointer">
            <Plus className="w-4 h-4" /> New plan
          </button>
        )}

        {/* ── Add / edit form ── */}
        {showForm && (
          <div className="mb-6 rounded-lg border border-sky-400/30 bg-navy-800 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold">{editId ? 'Edit plan' : 'New plan'}</h2>
              <button onClick={closeForm} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div><FieldLabel>Name *</FieldLabel><input className="form-input" value={form.name} onChange={e => set('name', e.target.value)} /></div>
              <div><FieldLabel>Phone</FieldLabel><input className="form-input" type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
              <div className="sm:col-span-2"><FieldLabel>Address</FieldLabel><input className="form-input" value={form.address} onChange={e => set('address', e.target.value)} /></div>
              <div><FieldLabel>Suburb</FieldLabel><input className="form-input" value={form.suburb} onChange={e => set('suburb', e.target.value)} /></div>
              <div><FieldLabel>Email</FieldLabel><input className="form-input" type="email" value={form.email} onChange={e => set('email', e.target.value)} /></div>
            </div>

            <div>
              <FieldLabel>Services *</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {SERVICE_OPTIONS.map(o => {
                  const active = selectedServices.includes(o.v);
                  return (
                    <button key={o.v} type="button" onClick={() => toggleService(o.v)} className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${active ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                      {o.l}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <FieldLabel>How often *</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(FREQ_LABEL) as RecurringFrequency[]).map(f => (
                  <button key={f} type="button" onClick={() => pickFrequency(f)} className={`px-2 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${form.frequency === f ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                    {FREQ_LABEL[f]}
                  </button>
                ))}
              </div>
              {form.frequency === 'custom' && (
                <div className="mt-2">
                  <FieldLabel>Every how many weeks? *</FieldLabel>
                  <input className="form-input" inputMode="numeric" placeholder="e.g. 3" value={form.customIntervalWeeks} onChange={e => set('customIntervalWeeks', e.target.value.replace(/[^0-9]/g, ''))} />
                  <p className="text-slate-500 text-xs mt-1">
                    Set "Next visit" to the right day once (e.g. a Saturday) and every cycle keeps landing on it — that's how you'd do "every other Saturday": Fortnightly, next visit on a Saturday.
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><FieldLabel>Next visit *</FieldLabel><input className="form-input" type="date" value={form.nextDate} onChange={e => set('nextDate', e.target.value)} /></div>
              <div><FieldLabel>Preferred time</FieldLabel><input className="form-input" placeholder="e.g. Morning" value={form.preferredTime} onChange={e => set('preferredTime', e.target.value)} /></div>
              <div className="col-span-2">
                <FieldLabel>What it's worth per visit ($)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input className="form-input pl-8" inputMode="decimal" placeholder="e.g. 180" value={form.visitPrice} onChange={e => set('visitPrice', e.target.value)} />
                </div>
              </div>
            </div>

            <div>
              <FieldLabel>Billing cycle *</FieldLabel>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(BILLING_LABEL) as BillingCycle[]).map(c => (
                  <button key={c} type="button" onClick={() => pickBilling(c)} className={`px-2 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${form.billingCycle === c ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                    {BILLING_LABEL[c]}
                  </button>
                ))}
              </div>
              {form.billingCycle === 'custom' && (
                <input className="form-input mt-2" placeholder="e.g. Invoiced quarterly in advance" value={form.customBillingCycle} onChange={e => set('customBillingCycle', e.target.value)} />
              )}
            </div>

            <div><FieldLabel>Notes</FieldLabel><textarea className="form-input resize-none" rows={2} placeholder="Access notes, standing instructions" value={form.notes} onChange={e => set('notes', e.target.value)} /></div>

            <button onClick={save} disabled={saving} className="w-full py-3 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              {editId ? 'Save changes' : 'Create plan'}
            </button>
          </div>
        )}

        {/* ── Plan list ── */}
        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-24 bg-white/5 rounded-lg animate-pulse" />)}</div>
        ) : jobs.length === 0 && !showForm ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No plans yet. Put a repeat customer on a plan and their next clean books itself in.
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map(j => (
              <li key={j.id} className={`rounded-lg border p-4 ${j.active ? 'border-white/10 bg-navy-800' : 'border-white/5 bg-navy-800/50 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => openEdit(j)} className="min-w-0 text-left cursor-pointer">
                    <div className="text-white font-semibold truncate">{j.name}</div>
                    <div className="text-slate-400 text-xs mt-0.5 truncate">{serviceText(j.service)}</div>
                  </button>
                  <span className="flex-shrink-0 inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky-400/15 text-sky-400 border border-sky-400/20">
                    {freqBadge(j)}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400">
                  <span className={`inline-flex items-center gap-1.5 ${j.active && dueSoon(j.nextDate) ? 'text-amber-400 font-semibold' : ''}`}>
                    <CalendarDays className="w-3.5 h-3.5" />
                    Next: {new Date(`${j.nextDate}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  {j.suburb && <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> {j.suburb}</span>}
                  {j.phone && <a href={`tel:${j.phone}`} className="inline-flex items-center gap-1.5 text-sky-400"><PhoneIcon className="w-3.5 h-3.5" /> {j.phone}</a>}
                  {j.visitPrice != null && j.visitPrice > 0 && <span className="text-white font-semibold">${j.visitPrice}/visit</span>}
                  <span className="text-slate-500">Billed: {billingBadge(j)}</span>
                </div>

                <button
                  onClick={() => generateNext(j)}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 active:bg-sky-400/20 text-xs font-semibold transition-colors cursor-pointer touch-manipulation"
                >
                  <CalendarPlus className="w-4 h-4" /> Generate next visit &amp; add to calendar
                </button>

                <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                  <button onClick={() => toggleActive(j)} className={`text-xs font-semibold cursor-pointer ${j.active ? 'text-slate-400 hover:text-amber-400' : 'text-emerald-400'}`}>
                    {j.active ? 'Pause plan' : 'Resume plan'}
                  </button>
                  <div className="flex items-center gap-4">
                    {j.lastBookingId && (
                      <Link href={`/admin/bookings/${j.lastBookingId}?from=${encodeURIComponent('/admin/recurring')}`} className="text-xs text-sky-400 hover:text-sky-300">Last booking</Link>
                    )}
                    <button onClick={() => remove(j)} aria-label="Delete plan" className="text-slate-500 hover:text-red-400 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      </div>
      <AdminMobileNav active="recurring" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="recurring" items={navItems} />
    </div>
  );
}

export default function RecurringPage() {
  return (
    <Suspense fallback={<div className="min-h-[100svh] bg-navy-900" />}>
      <RecurringInner />
    </Suspense>
  );
}
