'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, FileSignature, Share, Copy, ExternalLink, Search, X } from 'lucide-react';
import { type Quote, type QuoteStatus, money, longDate, buildQuoteText } from '@/lib/quote';
import type { Booking } from '@/lib/db';
import { AdminSidebar, AdminMobileNav, AdminMoreSheet, useMoreSheet, adminNavItems } from '@/components/admin/AdminNav';
import QuoteModal from '@/components/QuoteModal';

const STATUS_LABEL: Record<QuoteStatus, string> = { draft: 'Draft', sent: 'Sent' };
const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
  sent: 'bg-sky-400/15 text-sky-300 border-sky-400/25',
};

const serviceTextForBooking = (s: string) => (s ?? '').split(',').filter(Boolean).join(' + ') || '-';

export default function QuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [modalFor, setModalFor] = useState<{ bookingId: string; booking: Booking | null; initial: Quote | null } | null>(null);

  const load = async () => {
    try {
      const [qRes, bRes] = await Promise.all([fetch('/api/admin/quotes'), fetch('/api/admin/bookings')]);
      if (qRes.status === 401) { router.push('/admin'); return; }
      if (qRes.ok) setQuotes(await qRes.json());
      if (bRes.ok) { const data = await bRes.json(); setBookings(Array.isArray(data) ? data : (data.bookings ?? [])); }
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const bookingFor = (id: string) => bookings.find(b => b.id === id) ?? null;

  const filteredBookings = bookings.filter(b => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.phone, b.address, b.suburb].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const share = async (q: Quote) => {
    const url = `${window.location.origin}/quote/${q.token}`;
    const title = `Quote ${q.number} — ${q.fromTradingAs}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) { try { await nav.share({ title, text: title, url }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Copy failed'); } }
  };
  const copy = async (q: Quote) => {
    try { await navigator.clipboard.writeText(buildQuoteText(q)); toast.success('Quote text copied'); }
    catch { toast.error('Copy failed'); }
  };

  const moreSheet = useMoreSheet();
  const navItems = adminNavItems();
  const iconBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer touch-manipulation border-white/10 text-slate-300 hover:text-white';

  return (
    <div className="min-h-[100svh] bg-navy-900 flex">
      <AdminSidebar active="quotes" items={navItems} />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
        >
          <button onClick={() => router.push('/admin/dashboard')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer lg:hidden">
            <ArrowLeft className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={() => setPickerOpen(true)} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
            <Plus className="w-4 h-4" /> New quote
          </button>
        </header>

        <main className="max-w-2xl mx-auto w-full px-4 py-6 pb-28">
          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
              <FileSignature className="w-6 h-6 text-sky-400" /> Quotes
            </h1>
            <p className="text-slate-500 text-xs mt-1">
              {loading ? 'Loading…' : `${quotes.length} quote${quotes.length !== 1 ? 's' : ''}`}
            </p>
          </div>

          {loading ? (
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
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${STATUS_STYLE[q.status]}`}>{STATUS_LABEL[q.status]}</span>
                          </div>
                          <div className="text-slate-400 text-sm mt-0.5 truncate">{q.billToName || b?.name || 'No recipient'}</div>
                          <div className="text-slate-500 text-xs mt-0.5">
                            {longDate(q.quoteDate)}{b ? ` · ${serviceTextForBooking(b.service)}` : ''}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-white font-bold">{money(q.amount)}</div>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {b && (
                          <Link href={`/admin/bookings/${b.id}?from=/admin/quotes`} className={iconBtn}>
                            View job
                          </Link>
                        )}
                        <button onClick={() => copy(q)} title="Copy quote text" className={`${iconBtn} ml-auto`}><Copy className="w-3.5 h-3.5" /></button>
                        <button onClick={() => share(q)} title="Share quote link" className={iconBtn}><Share className="w-3.5 h-3.5" /></button>
                        <a href={`/quote/${q.token}`} target="_blank" rel="noopener noreferrer" title="Open" className={iconBtn}><ExternalLink className="w-3.5 h-3.5" /></a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>
      <AdminMobileNav active="quotes" items={navItems} onMore={moreSheet.show} />
      <AdminMoreSheet open={moreSheet.open} onClose={moreSheet.hide} active="quotes" items={navItems} />

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
