'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, FileText, Send, BadgeCheck, Share, Undo2, Eye, Banknote, ScrollText, X, Smartphone, Tablet, Monitor, MapPin, Clock } from 'lucide-react';
import { type Invoice, type InvoiceStatus, type PaymentMethod, PAYMENT_METHOD_LABEL, money, longDate } from '@/lib/invoice';
import type { AppSettings } from '@/lib/settings';
import { ACTIVITY_TYPE_LABEL, type ActivityEntry, type InvoiceViewSession } from '@/lib/activity';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

const DEVICE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { Mobile: Smartphone, Tablet, Desktop: Monitor };

function formatDuration(seconds: number | null): string {
  if (seconds == null) return 'still open / unknown';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Merged view-log modal for one invoice: every public-page open (device, IP,
// approximate location, how long it stayed open) plus the events tied to it
// (paid claims, Square confirmation, pay-by-card clicks, status changes).
function ViewLogModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [sessions, setSessions] = useState<InvoiceViewSession[] | null>(null);
  const [events, setEvents] = useState<ActivityEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/invoices/${invoice.id}/views`);
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions);
          setEvents(data.events);
        }
      } finally { setLoading(false); }
    })();
  }, [invoice.id]);

  type Row = { time: string; kind: 'view' | 'event'; session?: InvoiceViewSession; event?: ActivityEntry };
  const rows: Row[] = [
    ...(sessions ?? []).map(s => ({ time: s.startedAt, kind: 'view' as const, session: s })),
    ...(events ?? []).map(e => ({ time: e.createdAt, kind: 'event' as const, event: e })),
  ].sort((a, b) => b.time.localeCompare(a.time));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-white/10 bg-navy-800" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <h2 className="text-white font-semibold flex items-center gap-2"><ScrollText className="w-4 h-4 text-sky-400" /> {invoice.number} — view log</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {loading ? (
            <div className="text-center text-slate-600 text-sm py-8">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-600 text-sm py-8">No opens or activity recorded yet.</div>
          ) : rows.map((r, i) => {
            if (r.kind === 'view' && r.session) {
              const s = r.session;
              const Icon = DEVICE_ICON[s.deviceType] ?? Monitor;
              const where = [s.city, s.region, s.country].filter(Boolean).join(', ');
              return (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex items-center gap-2 text-slate-200 text-sm font-medium">
                    <Icon className="w-4 h-4 text-sky-400" /> {s.deviceType} · {s.browser}
                    <span className="ml-auto text-slate-500 text-xs">{timeAgo(s.startedAt)}</span>
                  </div>
                  <div className="mt-1.5 text-slate-400 text-xs space-y-1">
                    <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> {where || 'Unknown location'} · IP {s.ip || 'unknown'}</div>
                    <div className="flex items-center gap-1.5"><Clock className="w-3 h-3" /> Open for {formatDuration(s.durationSeconds)}</div>
                  </div>
                </div>
              );
            }
            const e = r.event!;
            return (
              <div key={i} className="rounded-lg border border-white/5 bg-white/[0.01] p-3">
                <div className="text-slate-200 text-sm">{e.summary}</div>
                <div className="text-slate-600 text-xs mt-0.5">{ACTIVITY_TYPE_LABEL[e.type] ?? e.type} · {timeAgo(e.createdAt)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<InvoiceStatus, string> = { draft: 'Draft', sent: 'Sent', paid: 'Paid', cancelled: 'Cancelled' };
const STATUS_STYLE: Record<InvoiceStatus, string> = {
  draft: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
  sent: 'bg-sky-400/15 text-sky-300 border-sky-400/25',
  paid: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/25',
  cancelled: 'bg-red-400/15 text-red-300 border-red-400/25',
};

// Sent → Read → Paid lifecycle at a glance. "Read" = the customer opened the
// public link (firstViewedAt); "Paid" = status paid (which also marks linked jobs paid).
function SentReadPaid({ inv }: { inv: Invoice }) {
  const steps = [
    { label: 'Sent', on: inv.status === 'sent' || inv.status === 'paid' || !!inv.sentAt },
    { label: 'Read', on: !!inv.firstViewedAt },
    { label: 'Paid', on: inv.status === 'paid' },
  ];
  return (
    <div className="mt-1.5 flex items-center gap-2">
      {steps.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-slate-700 text-[11px]">›</span>}
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${s.on ? 'text-emerald-400' : 'text-slate-600'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${s.on ? 'bg-emerald-400' : 'bg-slate-600'}`} /> {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guests share this page but only ever see their own invoices, and Back must
  // return them to the guest dashboard rather than the admin one.
  const [isGuest, setIsGuest] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [viewLogFor, setViewLogFor] = useState<Invoice | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, res, settingsRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/invoices'),
          fetch('/api/admin/settings'),
        ]);
        if (meRes.ok) setIsGuest((await meRes.json()).role === 'guest');
        if (res.status === 401) { router.push('/admin'); return; }
        if (res.ok) setInvoices(await res.json());
        if (settingsRes.ok) setSettings(await settingsRes.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  const backHref = isGuest ? '/guest' : '/admin/dashboard';

  const unpaidTotal = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + i.total, 0);

  const setStatus = async (inv: Invoice, status: InvoiceStatus, paymentMethod?: PaymentMethod) => {
    setBusyId(inv.id);
    try {
      const body: Record<string, unknown> = { status };
      if (paymentMethod) body.paymentMethod = paymentMethod;
      const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error();
      const updated: Invoice = await res.json();
      setInvoices(list => list.map(i => i.id === inv.id ? updated : i));
      toast.success(status === 'paid' && paymentMethod ? `Marked paid — ${PAYMENT_METHOD_LABEL[paymentMethod].toLowerCase()}` : `Marked ${STATUS_LABEL[status].toLowerCase()}`);
    } catch { toast.error('Update failed'); }
    finally { setBusyId(null); }
  };

  // Native share sheet on iPhone; falls back to copying the link elsewhere.
  const share = async (inv: Invoice) => {
    const url = `${window.location.origin}/invoice/${inv.token}`;
    const title = `${inv.isTaxInvoice ? 'Tax Invoice' : 'Invoice'} ${inv.number} — Glass and Blast`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title, text: title, url }); }
      catch { /* user dismissed the share sheet */ }
    } else {
      try { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
      catch { toast.error('Copy failed'); }
    }
  };

  const iconBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer touch-manipulation disabled:opacity-50';
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      {!isGuest && <AdminSidebar active="invoices" items={navItems} />}
      <div className="flex-1 flex flex-col min-w-0">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push(backHref)} className={`inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer ${isGuest ? '' : 'lg:hidden'}`}>
          <ArrowLeft className="w-5 h-5" /> {isGuest ? 'My jobs' : 'Dashboard'}
        </button>
        <Link href="/admin/invoices/new" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
          <Plus className="w-4 h-4" /> New invoice
        </Link>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-sky-400" /> Invoices
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            {loading ? 'Loading…' : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}`}
            {!loading && unpaidTotal > 0 ? ` · ${money(unpaidTotal)} outstanding` : ''}
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-28 bg-white/5 rounded-xl animate-pulse" />)}</div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-sm">
            No invoices yet.
            <div className="mt-4">
              <Link href="/admin/invoices/new" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
                <Plus className="w-4 h-4" /> Create your first invoice
              </Link>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {invoices.map(inv => (
              <li key={inv.id}>
                <div
                  onClick={() => router.push(`/admin/invoices/${inv.id}`)}
                  className="rounded-xl border border-white/10 bg-navy-800 p-4 hover:border-sky-400/30 hover:bg-white/[0.02] transition-colors cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{inv.number}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_STYLE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                        {inv.status === 'paid' && inv.paymentMethod && inv.paymentMethod !== 'bank_transfer' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-400/25 bg-amber-400/10 text-amber-300">
                            <Banknote className="w-3 h-3" /> {PAYMENT_METHOD_LABEL[inv.paymentMethod]}
                          </span>
                        )}
                        {!!settings?.squareCardPaymentsEnabled && inv.status !== 'paid' && inv.squarePaidAt && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-400/25 bg-amber-400/10 text-amber-300" title="Square confirms this was paid by card — verify the money's in the account, then confirm">
                            <Banknote className="w-3 h-3" /> Square says paid
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-sm mt-0.5 truncate">{inv.billToName || inv.client.clientName || 'No recipient'}</div>
                      <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                        <span>{longDate(inv.invoiceDate)}</span>
                        {inv.firstViewedAt ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400" title={`Customer opened this ${longDate(inv.lastViewedAt || inv.firstViewedAt)}`}>
                            <Eye className="w-3 h-3" /> Seen{inv.viewCount > 1 ? ` ${inv.viewCount}×` : ''}
                          </span>
                        ) : inv.status === 'sent' ? (
                          <span className="text-slate-600">Not opened yet</span>
                        ) : null}
                      </div>
                      <SentReadPaid inv={inv} />
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white font-bold">{money(inv.total)}</div>
                      {inv.isTaxInvoice && <div className="text-slate-500 text-[11px] mt-0.5">Tax invoice</div>}
                    </div>
                  </div>

                  {/* Quick actions — dead zone: stop the row-open click so these act on their own */}
                  <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    {inv.status === 'draft' && (
                      <button disabled={busyId === inv.id} onClick={() => setStatus(inv, 'sent')} className={`${iconBtn} border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15`}>
                        <Send className="w-3.5 h-3.5" /> Mark sent
                      </button>
                    )}
                    {(inv.status === 'draft' || inv.status === 'sent') && (
                      <div className="relative">
                        <select
                          disabled={busyId === inv.id}
                          value=""
                          onChange={e => { const v = e.target.value as PaymentMethod; if (v) setStatus(inv, 'paid', v); }}
                          className={`${iconBtn} appearance-none pl-7 pr-6 border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15`}
                          title="Mark paid — choose how"
                        >
                          <option value="" disabled>Mark paid…</option>
                          <option value="bank_transfer">Bank transfer</option>
                          <option value="cash">Cash (in person)</option>
                          <option value="card">Card (in person)</option>
                          <option value="other">Other</option>
                        </select>
                        <BadgeCheck className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                    )}
                    {inv.status === 'paid' && (
                      <button disabled={busyId === inv.id} onClick={() => setStatus(inv, 'sent')} className={`${iconBtn} border-white/10 text-slate-400 hover:text-white`}>
                        <Undo2 className="w-3.5 h-3.5" /> Unmark paid
                      </button>
                    )}
                    {!!settings?.squareCardPaymentsEnabled && inv.status !== 'paid' && inv.squarePaidAt && (
                      <button disabled={busyId === inv.id} onClick={() => setStatus(inv, 'paid', 'card')} className={`${iconBtn} border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15`}>
                        <BadgeCheck className="w-3.5 h-3.5" /> Confirm Square paid
                      </button>
                    )}
                    <button onClick={() => setViewLogFor(inv)} title="View log" aria-label="View log" className={`${iconBtn} ml-auto border-white/10 text-slate-300 hover:text-white`}>
                      <ScrollText className="w-3.5 h-3.5" /> View log
                    </button>
                    <button onClick={() => share(inv)} title="Share invoice link" aria-label="Share invoice link" className={`${iconBtn} border-white/10 text-slate-300 hover:text-white`}>
                      <Share className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {viewLogFor && <ViewLogModal invoice={viewLogFor} onClose={() => setViewLogFor(null)} />}
      </main>
      </div>
      {!isGuest && <>
        <AdminMobileNav active="invoices" items={navItems} onMore={moreSheet.show} />
        <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="invoices" items={navItems} />
      </>}
    </div>
  );
}
