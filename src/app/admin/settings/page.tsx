'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Settings as SettingsIcon, Save, ShieldAlert, Building2, Banknote,
  CreditCard, Bell, Star, CalendarClock,
} from 'lucide-react';
import type { AppSettings } from '@/lib/settings';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-navy-800 p-4 sm:p-5">
      <h2 className="text-white font-semibold text-sm flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-sky-400" /> {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function L({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1">{children}</label>;
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <L>{label}</L>
      <input
        type={type}
        className="form-input text-sm w-full"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

// Themed checkbox-as-switch — blends with the dark card instead of a native
// white box, but stays clearly readable as a toggle.
function Toggle({ label, sub, checked, onChange, disabled }: {
  label: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={`flex items-start justify-between gap-3 py-1.5 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <div className="min-w-0">
        <div className="text-white text-sm font-medium">{label}</div>
        {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
      </div>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 flex-shrink-0 appearance-none w-9 h-5 rounded-full border border-white/20 bg-white/10 checked:bg-sky-500 checked:border-sky-500 cursor-pointer disabled:cursor-not-allowed relative transition-colors before:content-[''] before:absolute before:top-[1px] before:left-[1px] before:w-[16px] before:h-[16px] before:rounded-full before:bg-slate-300 checked:before:bg-white before:transition-transform checked:before:translate-x-4"
      />
    </label>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [role, setRole] = useState<'admin' | 'guest' | null>(null);
  const [s, setS] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  useEffect(() => {
    (async () => {
      try {
        const [meRes, settingsRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/settings'),
        ]);
        if (meRes.status === 401 || settingsRes.status === 401) { router.push('/admin'); return; }
        if (meRes.ok) setRole((await meRes.json()).role);
        if (settingsRes.ok) setS(await settingsRes.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setS(prev => prev ? { ...prev, [key]: value } : prev);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setS(await res.json());
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="settings" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
        >
          <button onClick={() => router.push('/admin/dashboard')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer lg:hidden">
            <ArrowLeft className="w-5 h-5" /> Dashboard
          </button>
          {role === 'admin' && (
            <button onClick={save} disabled={saving || !s} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">
              {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />} Save changes
            </button>
          )}
        </header>

        <main className="max-w-2xl mx-auto w-full px-4 py-6 pb-28">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <SettingsIcon className="w-6 h-6 text-sky-400" /> Settings
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              Business-wide config — changes apply immediately, no redeploy needed.
            </p>
          </div>

          {loading ? (
            <div className="space-y-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />)}</div>
          ) : role !== 'admin' ? (
            <div className="max-w-sm mx-auto text-center py-16">
              <span className="w-14 h-14 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
                <ShieldAlert className="w-7 h-7 text-red-400" />
              </span>
              <h2 className="font-display text-xl font-bold text-white mt-4">Admin only</h2>
              <p className="text-slate-500 text-sm mt-2">Settings can only be changed by the master admin login.</p>
            </div>
          ) : s && (
            <div className="space-y-4">
              <Section title="Business info" icon={Building2}>
                <p className="text-slate-500 text-xs -mt-1 mb-2">Pre-fills new invoices. Already-created invoices keep their own saved copy.</p>
                <Field label="Business name" value={s.businessName} onChange={v => set('businessName', v)} />
                <Field label="Trading as" value={s.tradingAs} onChange={v => set('tradingAs', v)} />
                <Field label="ABN" value={s.abn} onChange={v => set('abn', v)} />
                <Field label="Address" value={s.address} onChange={v => set('address', v)} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" value={s.email} onChange={v => set('email', v)} type="email" />
                  <Field label="Phone" value={s.phone} onChange={v => set('phone', v)} />
                </div>
              </Section>

              <Section title="Payment defaults" icon={Banknote}>
                <p className="text-slate-500 text-xs -mt-1 mb-2">Pre-fills new invoices — the payment profile picker can still override per-invoice.</p>
                <Field label="Account name" value={s.payAccountName} onChange={v => set('payAccountName', v)} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="BSB" value={s.payBsb} onChange={v => set('payBsb', v)} />
                  <Field label="Account number" value={s.payAccountNumber} onChange={v => set('payAccountNumber', v)} />
                </div>
                <Field label="Default payment terms (days)" type="number" value={s.defaultPaymentTermsDays} onChange={v => set('defaultPaymentTermsDays', Number(v) || 0)} />
                <div>
                  <L>Default invoice footer note</L>
                  <textarea className="form-input text-sm w-full" rows={2} value={s.defaultInvoiceNotes} onChange={e => set('defaultInvoiceNotes', e.target.value)} />
                </div>
                <div>
                  <L>GST disclaimer wording</L>
                  <textarea className="form-input text-sm w-full" rows={2} value={s.gstNoteText} onChange={e => set('gstNoteText', e.target.value)} />
                  <p className="text-slate-600 text-xs mt-1">Wording only — this does not calculate or add GST to totals. Consult your accountant if your GST-registration status changes.</p>
                </div>
              </Section>

              <Section title="Card payments (Square)" icon={CreditCard}>
                <Toggle
                  label="Card payments enabled"
                  sub="Shows the customer-facing Pay-by-card button and admin link generation. Also needs SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID set in env — this toggle alone can't turn it on without those."
                  checked={s.squareCardPaymentsEnabled}
                  onChange={v => set('squareCardPaymentsEnabled', v)}
                />
                <Field label="Card surcharge (%)" type="number" value={s.squareSurchargePercent} onChange={v => set('squareSurchargePercent', Number(v) || 0)} />
                <p className="text-slate-600 text-xs">Check this against your actual contracted Square rate (Square dashboard → Fees).</p>
              </Section>

              <Section title="Notifications" icon={Bell}>
                <Toggle label="Notifications enabled" sub="Master switch — turns every push below on/off at once." checked={s.notificationsEnabled} onChange={v => set('notificationsEnabled', v)} />
                <div className="pl-1 border-l-2 border-white/5 ml-1 space-y-1">
                  <Toggle label="Job status changed" disabled={!s.notificationsEnabled} checked={s.notifyStatusChange} onChange={v => set('notifyStatusChange', v)} />
                  <Toggle label="Job sent to a subcontractor" disabled={!s.notificationsEnabled} checked={s.notifyJobAssigned} onChange={v => set('notifyJobAssigned', v)} />
                  <Toggle label="Customer taps &quot;I&apos;ve paid&quot;" disabled={!s.notificationsEnabled} checked={s.notifyCustomerMarkedPaid} onChange={v => set('notifyCustomerMarkedPaid', v)} />
                  <Toggle label="Square confirms a card payment" disabled={!s.notificationsEnabled} checked={s.notifySquarePaid} onChange={v => set('notifySquarePaid', v)} />
                  <Toggle label="New booking from the website" disabled={!s.notificationsEnabled} checked={s.notifyNewBooking} onChange={v => set('notifyNewBooking', v)} />
                </div>
              </Section>

              <Section title="Reviews & feedback" icon={Star}>
                <Field label="Google review link" value={s.googleReviewUrl} onChange={v => set('googleReviewUrl', v)} placeholder="https://g.page/r/.../review" />
                <div>
                  <L>Star rating that goes straight to Google</L>
                  <select className="form-input text-sm w-full" value={s.reviewStarThreshold} onChange={e => set('reviewStarThreshold', Number(e.target.value))}>
                    {[3, 4, 5].map(n => <option key={n} value={n}>{n}+ stars → Google review</option>)}
                  </select>
                  <p className="text-slate-600 text-xs mt-1">Ratings below this open a private feedback box instead.</p>
                </div>
              </Section>

              <Section title="Scheduling" icon={CalendarClock}>
                <Field label="Default job start time" type="time" value={s.defaultJobStartTime} onChange={v => set('defaultJobStartTime', v)} />
                <p className="text-slate-600 text-xs">Used when a recurring plan auto-books its next visit onto the calendar. Manually scheduling a job on the calendar is unaffected.</p>
              </Section>
            </div>
          )}
        </main>
      </div>
      <AdminMobileNav active="settings" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="settings" items={navItems} />
    </div>
  );
}
