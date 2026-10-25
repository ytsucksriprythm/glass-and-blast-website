'use client';

// All recurring customers. Each opens their profile (/admin/recurring/[id]),
// where their jobs live. Most profiles are made from a job ("Make recurring
// customer" on the booking page); "New recurring customer" here is for typing
// one in from scratch.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Repeat, Plus, Check, X, Play, MapPin, CalendarDays, ChevronRight } from 'lucide-react';
import type { RecurringJob } from '@/lib/db';
import { frequencyLabel, profileHref } from '@/lib/recurring';
import PlanPicker, { DEFAULT_PLAN, planPayload, type PlanValue } from '@/components/admin/PlanPicker';
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

type NewForm = { name: string; phone: string; email: string; address: string; suburb: string; service: string; nextDate: string; visitPrice: string; plan: PlanValue };
const EMPTY: NewForm = { name: '', phone: '', email: '', address: '', suburb: '', service: 'window-washing', nextDate: '', visitPrice: '', plan: DEFAULT_PLAN };

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}

export default function RecurringPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<RecurringJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NewForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  const set = (k: keyof Omit<NewForm, 'plan'>, v: string) => setForm(f => ({ ...f, [k]: v }));
  const selectedServices = form.service ? form.service.split(',') : [];
  const toggleService = (v: string) => setForm(f => {
    const list = f.service ? f.service.split(',') : [];
    return { ...f, service: (list.includes(v) ? list.filter(x => x !== v) : [...list, v]).join(',') };
  });

  const loadJobs = async () => {
    const res = await fetch('/api/admin/recurring');
    if (res.status === 401) { router.push('/admin'); return; }
    if (res.ok) setJobs(await res.json());
  };
  useEffect(() => { loadJobs().finally(() => setLoading(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    if (!form.name.trim() || !form.service || !form.nextDate) { toast.error('Name, service and first visit date are needed'); return; }
    const plan = planPayload(form.plan);
    if (!plan) { toast.error('Type how many for the custom timeframe'); return; }
    setSaving(true);
    try {
      const price = Number(form.visitPrice.replace(/[^0-9.]/g, ''));
      const res = await fetch('/api/admin/recurring', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...plan, name: form.name.trim(), phone: form.phone, email: form.email, address: form.address, suburb: form.suburb,
          service: form.service, nextDate: form.nextDate, visitPrice: form.visitPrice.trim() && price > 0 ? price : null,
        }),
      });
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const { job } = await res.json();
      toast.success('Recurring customer created');
      router.push(profileHref(job.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  // Manual trigger of the daily cron — books in anything due today.
  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/cron/recurring');
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(data.created > 0 ? `${data.created} booking${data.created > 1 ? 's' : ''} created` : 'Nothing due yet');
      if (data.created > 0) await loadJobs();
    } catch { toast.error('Run failed'); }
    finally { setRunning(false); }
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
        <button onClick={runNow} disabled={running} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-slate-200 hover:text-white hover:border-amber-400/40 text-sm cursor-pointer disabled:opacity-50">
          {running ? <div className="w-4 h-4 border-2 border-white/20 border-t-amber-400 rounded-full animate-spin" /> : <Play className="w-4 h-4" />} Book in due jobs
        </button>
      </header>

      <main className="max-w-xl w-full mx-auto px-4 py-6 pb-28">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Repeat className="w-6 h-6 text-amber-300" /> Recurring customers
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Tap a customer to see their jobs and book the next one. To add one, open any job and hit <span className="text-amber-300">Make recurring customer</span>.
          </p>
        </div>

        {!showForm && (
          <button onClick={() => { setForm(EMPTY); setShowForm(true); }} className="mb-5 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-white/10 bg-white/[0.03] text-slate-300 hover:text-white hover:border-amber-400/40 text-sm font-semibold transition-colors cursor-pointer">
            <Plus className="w-4 h-4 text-amber-300" /> New recurring customer from scratch
          </button>
        )}

        {showForm && (
          <div className="mb-6 rounded-lg border border-amber-400/30 bg-navy-800 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-white font-semibold">New recurring customer</h2>
              <button onClick={() => setShowForm(false)} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
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
                {SERVICE_OPTIONS.map(o => (
                  <button key={o.v} type="button" onClick={() => toggleService(o.v)} className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${selectedServices.includes(o.v) ? 'border-amber-400 bg-amber-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FieldLabel>How often *</FieldLabel>
              <PlanPicker value={form.plan} onChange={plan => setForm(f => ({ ...f, plan }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><FieldLabel>First visit *</FieldLabel><input className="form-input" type="date" value={form.nextDate} onChange={e => set('nextDate', e.target.value)} /></div>
              <div>
                <FieldLabel>Usual price ($)</FieldLabel>
                <input className="form-input" inputMode="decimal" placeholder="e.g. 280" value={form.visitPrice} onChange={e => set('visitPrice', e.target.value)} />
              </div>
            </div>
            <button onClick={create} disabled={saving} className="w-full py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-navy-900/30 border-t-navy-900 rounded-full animate-spin" /> : <Check className="w-4 h-4" />} Create profile
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-20 bg-white/5 rounded-lg animate-pulse" />)}</div>
        ) : jobs.length === 0 && !showForm ? (
          <div className="text-center py-16 text-slate-500 text-sm">No recurring customers yet.</div>
        ) : (
          <ul className="space-y-2.5">
            {jobs.map(j => (
              <li key={j.id}>
                <Link href={profileHref(j.id, '/admin/recurring')} className={`flex items-center gap-3 rounded-lg border p-4 transition-colors hover:border-amber-400/30 hover:bg-white/[0.03] ${j.active ? 'border-white/10 bg-navy-800' : 'border-white/5 bg-navy-800/50 opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="text-amber-300 font-semibold truncate flex items-center gap-1.5"><Repeat className="w-3.5 h-3.5 flex-shrink-0" /> {j.name}</div>
                    <div className="text-slate-400 text-xs mt-0.5 truncate">{serviceText(j.service)}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span className={`inline-flex items-center gap-1 ${j.active && dueSoon(j.nextDate) ? 'text-amber-400 font-semibold' : ''}`}>
                        <CalendarDays className="w-3.5 h-3.5" />
                        Next: {new Date(`${j.nextDate}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {j.suburb && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {j.suburb}</span>}
                      {!j.active && <span>Paused</span>}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-400/15 text-amber-200 border border-amber-400/20">{frequencyLabel(j)}</span>
                    {j.discount ? <div className="text-emerald-300 text-[11px] font-semibold mt-1">${j.discount} off</div> : null}
                    {j.portal && (
                      <div className="text-slate-400 text-[11px] mt-1 font-mono" title={j.portal.contract ? 'Agreement signed' : 'Agreement not signed yet'}>
                        PIN {j.portal.pin} {j.portal.contract ? <span className="text-emerald-300">✓</span> : <span className="text-amber-300">•</span>}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 flex-shrink-0" />
                </Link>
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
