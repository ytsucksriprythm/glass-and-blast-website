'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, FileText, Send, BadgeCheck, Share, Undo2, Eye, Banknote, ScrollText, X,
  Smartphone, Tablet, Monitor, MapPin, Clock, AlertTriangle, FileSignature, Copy, ExternalLink, Search, Trash2,
} from 'lucide-react';
import { type Invoice, type InvoiceStatus, type PaymentMethod, PAYMENT_METHOD_LABEL, isInvoiceOverdue, money, longDate } from '@/lib/invoice';
import { type Quote, type QuoteStatus, money as quoteMoney, longDate as quoteLongDate, buildQuoteText } from '@/lib/quote';
import type { AppSettings } from '@/lib/settings';
import type { Booking } from '@/lib/db';
import { ACTIVITY_TYPE_LABEL, type ActivityEntry, type InvoiceViewSession } from '@/lib/activity';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import QuoteModal from '@/components/QuoteModal';

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
          <h2 className="text-white font-semibold flex items-center gap-2"><ScrollText className="w-4 h-4 text-sky-400" /> {invoice.number} · view log</h2>
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

const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent' };
const QUOTE_STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
  sent: 'bg-sky-400/15 text-sky-300 border-sky-400/25',
};
const serviceTextForBooking = (s: string) => (s ?? '').split(',').filter(Boolean).join(' + ') || '-';

export default function InvoicesQuotesPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'invoices' | 'quotes'>('invoices');
  // Restore the tab from ?tab=… so a link like /admin/invoices?tab=quotes (or
  // the /admin/quotes redirect stub) lands on the right side. Runs client-side
  // only (window.location, not useSearchParams) so this stays a plain client
  // component with no Suspense-boundary requirement.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'quotes') setTab('quotes');
  }, []);

  // ─── Invoices ────────────────────────────────────────────────────────────
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Guests share this page but only ever see their own invoices, and Back must
  // return them to the guest dashboard rather than the admin one. Guests never
  // see the Quotes tab at all (quoting is an admin-only concern).
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
      } finally { setInvLoading(false); }
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
      toast.success(status === 'paid' && paymentMethod ? `Marked paid: ${PAYMENT_METHOD_LABEL[paymentMethod].toLowerCase()}` : `Marked ${STATUS_LABEL[status].toLowerCase()}`);
    } catch { toast.error('Update failed'); }
    finally { setBusyId(null); }
  };

  // Native share sheet on iPhone; falls back to copying the link elsewhere.
  const shareInvoice = async (inv: Invoice) => {
    const url = `${window.location.origin}/invoice/${inv.token}`;
    const title = `${inv.isTaxInvoice ? 'Tax Invoice' : 'Invoice'} ${inv.number} · Glass and Blast`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title, text: title, url }); }
      catch { /* user dismissed the share sheet */ }
    } else {
      try { await navigator.clipboard.writeText(url); toast.success('Link copied'); }
      catch { toast.error('Copy failed'); }
    }
  };

  // ─── Quotes (admin only) ─────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [modalFor, setModalFor] = useState<{ bookingId: string; booking: Booking | null; initial: Quote | null } | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);

  const loadQuotes = async () => {
    try {
      const [qRes, bRes] = await Promise.all([fetch('/api/admin/quotes'), fetch('/api/admin/bookings')]);
      if (qRes.status === 401) { router.push('/admin'); return; }
      if (qRes.ok) setQuotes(await qRes.json());
      if (bRes.ok) { const data = await bRes.json(); setBookings(Array.isArray(data) ? data : (data.bookings ?? [])); }
    } finally { setQuotesLoading(false); }
  };
  useEffect(() => { if (!isGuest) loadQuotes(); }, [isGuest]);

  const bookingFor = (id: string) => bookings.find(b => b.id === id) ?? null;
  const filteredBookings = bookings.filter(b => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.phone, b.address, b.suburb].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

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
  const removeQuote = async (q: Quote) => {
    if (!window.confirm(`Delete quote ${q.number}? This cannot be undone.`)) return;
    setDeletingQuoteId(q.id);
    try {
      const res = await fetch(`/api/admin/quotes/${q.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setQuotes(prev => prev.filter(x => x.id !== q.id));
      toast.success('Quote deleted');
    } catch { toast.error('Delete failed'); }
    finally { setDeletingQuoteId(null); }
  };

  const iconBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer touch-manipulation disabled:opacity-50';
  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();

  const switchTab = (t: 'invoices' | 'quotes') => {
    setTab(t);
    router.replace(`/admin/invoices${t === 'quotes' ? '?tab=quotes' : ''}`, { scroll: false });
  };

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
        {tab === 'invoices' ? (
          <Link href="/admin/invoices/new" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
            <Plus className="w-4 h-4" /> New invoice
          </Link>
        ) : (
          <button onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
            <Plus className="w-4 h-4" /> New quote
          </button>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <div className="mb-5">
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            {tab === 'invoices' ? <><FileText className="w-6 h-6 text-sky-400" /> Invoices</> : <><FileSignature className="w-6 h-6 text-sky-400" /> Quotes</>}
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            {tab === 'invoices'
              ? (invLoading ? 'Loading…' : `${invoices.length} invoice${invoices.length !== 1 ? 's' : ''}${!invLoading && unpaidTotal > 0 ? ` · ${money(unpaidTotal)} outstanding` : ''}`)
              : (quotesLoading ? 'Loading…' : `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}`)}
          </p>
        </div>

        {/* Two tabs to pick between — quotes tab hidden entirely for guests. */}
        {!isGuest && (
          <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-navy-800 p-1">
            <button onClick={() => switchTab('invoices')} className={`px-4 py-1.5 rounded-md text-sm font-semibold cursor-pointer transition-colors ${tab === 'invoices' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Invoices</button>
            <button onClick={() => switchTab('quotes')} className={`px-4 py-1.5 rounded-md text-sm font-semibold cursor-pointer transition-colors ${tab === 'quotes' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>Quotes</button>
          </div>
        )}

        {tab === 'invoices' ? (
          invLoading ? (
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
                          {isInvoiceOverdue(inv) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-red-400/30 bg-red-500/15 text-red-300" title={`Due ${longDate(inv.dueDate)}`}>
                              <AlertTriangle className="w-3 h-3" /> Overdue
                            </span>
                          )}
                          {inv.status === 'paid' && inv.paymentMethod && inv.paymentMethod !== 'bank_transfer' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-400/25 bg-amber-400/10 text-amber-300">
                              <Banknote className="w-3 h-3" /> {PAYMENT_METHOD_LABEL[inv.paymentMethod]}
                            </span>
                          )}
                          {!!settings?.squareCardPaymentsEnabled && inv.status !== 'paid' && inv.squarePaidAt && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-amber-400/25 bg-amber-400/10 text-amber-300" title="Square confirms this was paid by card, verify the money's in the account, then confirm">
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
                            title="Mark paid: choose how"
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
                      <button onClick={() => shareInvoice(inv)} title="Share invoice link" aria-label="Share invoice link" className={`${iconBtn} border-white/10 text-slate-300 hover:text-white`}>
                        <Share className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : (
          quotesLoading ? (
            <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-24 bg-white/5 rounded-xl animate-pulse" />)}</div>
          ) : quotes.length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              No quotes yet.
              <div className="mt-4">
                <button onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
                  <Plus className="w-4 h-4" /> Create your first quote
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {quotes.map(q => {
                const b = bookingFor(q.bookingId);
                return (
                  <li key={q.id}>
                    <div
                      onClick={() => setModalFor({ bookingId: q.bookingId, booking: b, initial: q })}
                      className="rounded-xl border border-white/10 bg-navy-800 p-4 hover:border-sky-400/30 hover:bg-white/[0.02] transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold">{q.number}</span>
                            {q.status !== 'draft' && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${QUOTE_STATUS_STYLE[q.status]}`}>{QUOTE_STATUS_LABEL[q.status]}</span>
                            )}
                          </div>
                          <div className="text-slate-400 text-sm mt-0.5 truncate">{q.billToName || b?.name || 'No recipient'}</div>
                          <div className="text-slate-500 text-xs mt-0.5">
                            {quoteLongDate(q.quoteDate)}{b ? ` · ${serviceTextForBooking(b.service)}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-white font-bold">{quoteMoney(q.amount)}</div>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {b && (
                          <Link href={`/admin/bookings/${b.id}?from=${encodeURIComponent('/admin/invoices?tab=quotes')}`} className={`${iconBtn} border-white/10 text-slate-300 hover:text-white`}>
                            View job
                          </Link>
                        )}
                        <button onClick={() => copyQuote(q)} title="Copy quote text" className={`${iconBtn} ml-auto border-white/10 text-slate-300 hover:text-white`}><Copy className="w-3.5 h-3.5" /></button>
                        <button onClick={() => shareQuote(q)} title="Share quote link" className={`${iconBtn} border-white/10 text-slate-300 hover:text-white`}><Share className="w-3.5 h-3.5" /></button>
                        <a href={`/quote/${q.token}`} target="_blank" rel="noopener noreferrer" title="Open" className={`${iconBtn} border-white/10 text-slate-300 hover:text-white`}><ExternalLink className="w-3.5 h-3.5" /></a>
                        <button onClick={() => removeQuote(q)} disabled={deletingQuoteId === q.id} title="Delete quote" className={`${iconBtn} border-red-400/30 text-red-300 hover:bg-red-400/10`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        )}
        {viewLogFor && <ViewLogModal invoice={viewLogFor} onClose={() => setViewLogFor(null)} />}
      </main>
      </div>
      {!isGuest && <>
        <AdminMobileNav active="invoices" items={navItems} onMore={moreSheet.show} />
        <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="invoices" items={navItems} />
      </>}

      {/* Booking picker for "New quote" */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2"><FileSignature className="w-4 h-4 text-sky-400" /> Pick a job to quote</h3>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-3 border-b border-white/5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input autoFocus className="form-input text-sm pl-9" placeholder="Search name, phone, address…" value={pickerSearch} onChange={e => setPickerSearch(e.target.value)} />
              </div>
            </div>
            <div className="overflow-y-auto p-2" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}>
              {filteredBookings.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-sm">No bookings found.</div>
              ) : filteredBookings.map(b => (
                <button
                  key={b.id}
                  onClick={() => { setPickerOpen(false); setPickerSearch(''); setModalFor({ bookingId: b.id, booking: b, initial: null }); }}
                  className="w-full text-left p-3 rounded-lg hover:bg-white/5 active:bg-white/10 cursor-pointer"
                >
                  <div className="text-white text-sm font-medium">{b.name}</div>
                  <div className="text-slate-500 text-xs mt-0.5 truncate">{[serviceTextForBooking(b.service), [b.address, b.suburb].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalFor && (
        <QuoteModal
          bookingId={modalFor.bookingId}
          booking={modalFor.booking}
          initial={modalFor.initial}
          onClose={() => setModalFor(null)}
          onSaved={q => setQuotes(prev => prev.some(x => x.id === q.id) ? prev.map(x => x.id === q.id ? q : x) : [q, ...prev])}
        />
      )}
    </div>
  );
}
