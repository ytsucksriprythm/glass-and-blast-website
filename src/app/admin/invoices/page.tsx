'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, FileText, Send, BadgeCheck, Share, Undo2, Eye } from 'lucide-react';
import { type Invoice, type InvoiceStatus, money, longDate } from '@/lib/invoice';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';

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

  useEffect(() => {
    (async () => {
      try {
        const [meRes, res] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/admin/invoices'),
        ]);
        if (meRes.ok) setIsGuest((await meRes.json()).role === 'guest');
        if (res.status === 401) { router.push('/admin'); return; }
        if (res.ok) setInvoices(await res.json());
      } finally { setLoading(false); }
    })();
  }, [router]);

  const backHref = isGuest ? '/guest' : '/admin/dashboard';

  const unpaidTotal = invoices.filter(i => i.status !== 'paid' && i.status !== 'cancelled').reduce((s, i) => s + i.total, 0);

  const setStatus = async (inv: Invoice, status: InvoiceStatus) => {
    setBusyId(inv.id);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      if (res.status === 401) { router.push('/admin'); return; }
      if (!res.ok) throw new Error();
      const updated: Invoice = await res.json();
      setInvoices(list => list.map(i => i.id === inv.id ? updated : i));
      toast.success(`Marked ${STATUS_LABEL[status].toLowerCase()}`);
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
                      <button disabled={busyId === inv.id} onClick={() => setStatus(inv, 'paid')} className={`${iconBtn} border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/15`}>
                        <BadgeCheck className="w-3.5 h-3.5" /> Mark paid
                      </button>
                    )}
                    {inv.status === 'paid' && (
                      <button disabled={busyId === inv.id} onClick={() => setStatus(inv, 'sent')} className={`${iconBtn} border-white/10 text-slate-400 hover:text-white`}>
                        <Undo2 className="w-3.5 h-3.5" /> Unmark paid
                      </button>
                    )}
                    <button onClick={() => share(inv)} title="Share invoice link" aria-label="Share invoice link" className={`${iconBtn} ml-auto border-white/10 text-slate-300 hover:text-white`}>
                      <Share className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
      </div>
      {!isGuest && <>
        <AdminMobileNav active="invoices" items={navItems} onMore={moreSheet.show} />
        <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="invoices" items={navItems} />
      </>}
    </div>
  );
}
