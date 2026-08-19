'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { X, Check, Copy, Share as ShareIcon, ExternalLink } from 'lucide-react';
import type { Booking } from '@/lib/db';
import {
  type Quote, type QuoteInput, type QuoteStatus,
  QUOTE_SERVICE_OPTIONS, QUOTE_EXTRA_OPTIONS, QUOTE_VALID_DAYS,
  DEFAULT_QUOTE_TERMS, addDays, buildQuoteText,
} from '@/lib/quote';
import { BUSINESS_DEFAULTS } from '@/lib/invoice';
import QuotePreview from './QuotePreview';

type Draft = QuoteInput;

const todayStr = () => new Date().toISOString().slice(0, 10);

function draftFromQuote(q: Quote): Draft {
  const { id, number, seq, token, createdAt, updatedAt, sentAt, ...rest } = q;
  return rest;
}

function blankDraft(bookingId: string, booking: Pick<Booking, 'name' | 'address' | 'suburb' | 'propertyType'> | null): Draft {
  const today = todayStr();
  return {
    bookingId,
    status: 'draft',
    services: [],
    extras: [],
    otherText: '',
    amount: 0,
    propertyType: booking?.propertyType === 'commercial' ? 'commercial' : 'residential',
    billToName: booking?.name ?? '',
    billToAddress: [booking?.address, booking?.suburb].filter(Boolean).join(', '),
    ...BUSINESS_DEFAULTS,
    quoteDate: today,
    validUntil: addDays(today, QUOTE_VALID_DAYS),
    notes: '',
    termsText: DEFAULT_QUOTE_TERMS,
  };
}

function L({ children }: { children: React.ReactNode }) {
  return <label className="block text-slate-400 text-xs font-medium mb-1.5">{children}</label>;
}

// Accepts either a fresh booking (initial: null, creating) or an existing
// quote to edit/resend (initial: a Quote) — one component serves both the
// booking-page "New quote" flow and the /admin/quotes list's edit flow.
export default function QuoteModal({ bookingId, booking, initial, onClose, onSaved }: {
  bookingId: string;
  booking: Pick<Booking, 'name' | 'address' | 'suburb' | 'propertyType'> | null;
  initial: Quote | null;
  onClose: () => void;
  onSaved: (q: Quote) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initial ? draftFromQuote(initial) : blankDraft(bookingId, booking));
  const [saved, setSaved] = useState<Quote | null>(initial);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'form' | 'preview'>('form');

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const toggleList = (key: 'services' | 'extras', value: string) => setDraft(d => {
    const list = d[key];
    const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value];
    return { ...d, [key]: next };
  });
  const onExtrasSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    set('extras', Array.from(e.target.selectedOptions).map(o => o.value));
  };

  const save = async () => {
    if (draft.services.length === 0 && draft.extras.length === 0 && !draft.otherText.trim()) {
      toast.error('Check at least one service, extra, or describe the job in Other');
      return;
    }
    setSaving(true);
    try {
      const url = saved ? `/api/admin/quotes/${saved.id}` : '/api/admin/quotes';
      const method = saved ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      if (!res.ok) { toast.error((await res.json()).error || 'Failed to save'); return; }
      const quote: Quote = await res.json();
      setSaved(quote);
      onSaved(quote);
      toast.success(initial || saved ? 'Quote updated' : `Quote ${quote.number} created`);
    } finally { setSaving(false); }
  };

  // Best-effort: Copy/Share both mean "this left my hands", so flip status to
  // 'sent' as a side effect. Never triggered by the public page being viewed
  // (that would falsely fire when the admin previews their own link).
  const markSent = async () => {
    if (!saved || saved.status === 'sent') return;
    try {
      const res = await fetch(`/api/admin/quotes/${saved.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'sent' as QuoteStatus }),
      });
      if (res.ok) { const q: Quote = await res.json(); setSaved(q); onSaved(q); }
    } catch { /* best-effort */ }
  };

  const copyText = async () => {
    if (!saved) return;
    try { await navigator.clipboard.writeText(buildQuoteText(saved)); toast.success('Quote text copied'); void markSent(); }
    catch { toast.error('Copy failed — select the text manually'); }
  };

  const shareLink = async () => {
    if (!saved) return;
    const url = `${window.location.origin}/quote/${saved.token}`;
    const title = `Quote ${saved.number} — ${saved.fromTradingAs}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title, text: title, url }); void markSent(); }
      catch { /* user dismissed the share sheet */ }
    } else {
      try { await navigator.clipboard.writeText(url); toast.success('Link copied'); void markSent(); }
      catch { toast.error('Copy failed'); }
    }
  };

  const previewData = { ...draft, status: draft.status ?? 'draft', number: saved?.number ?? 'Q----' };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className="bg-navy-800 border border-white/10 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-3xl max-h-[92svh] sm:max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <h3 className="text-white font-semibold flex items-center gap-2">
            {saved ? `${saved.number} — quote` : 'New quote'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        {/* Mobile form/preview tabs — desktop shows both side by side */}
        <div className="lg:hidden flex border-b border-white/10 flex-shrink-0">
          <button onClick={() => setTab('form')} className={`flex-1 py-2.5 text-sm font-semibold cursor-pointer ${tab === 'form' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500'}`}>Edit</button>
          <button onClick={() => setTab('preview')} className={`flex-1 py-2.5 text-sm font-semibold cursor-pointer ${tab === 'preview' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500'}`}>Preview</button>
        </div>

        <div className="flex-1 overflow-y-auto lg:flex lg:divide-x lg:divide-white/10">
          {/* Form */}
          <div className={`p-4 space-y-4 lg:w-1/2 ${tab === 'preview' ? 'hidden lg:block' : ''}`}>
            <div>
              <L>Services</L>
              <div className="flex flex-wrap gap-2">
                {QUOTE_SERVICE_OPTIONS.map(o => {
                  const active = draft.services.includes(o.key);
                  return (
                    <button key={o.key} type="button" onClick={() => toggleList('services', o.key)} className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${active ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`}>
                      {active ? '✓ ' : ''}{o.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <L>Extras</L>
              <select multiple size={3} value={draft.extras} onChange={onExtrasSelect} className="form-input text-sm w-full">
                {QUOTE_EXTRA_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <p className="text-slate-500 text-xs mt-1">Tap to select — tap again to deselect more than one.</p>
            </div>

            <div>
              <L>Other (anything not covered above)</L>
              <textarea className="form-input text-sm w-full resize-none" rows={2} value={draft.otherText} onChange={e => set('otherText', e.target.value)} placeholder="e.g. Clean upstairs balcony glass only" />
            </div>

            <div>
              <L>Total quote (AUD, lump sum)</L>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                <input className="form-input pl-8 text-sm w-full" inputMode="decimal" placeholder="e.g. 350" value={draft.amount || ''} onChange={e => set('amount', Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><L>Bill to</L><input className="form-input text-sm w-full" value={draft.billToName} onChange={e => set('billToName', e.target.value)} /></div>
              <div><L>Property</L>
                <select className="form-input text-sm w-full" value={draft.propertyType} onChange={e => set('propertyType', e.target.value as 'residential' | 'commercial')}>
                  <option value="residential">Residential</option>
                  <option value="commercial">Commercial</option>
                </select>
              </div>
              <div className="col-span-2"><L>Address</L><input className="form-input text-sm w-full" value={draft.billToAddress} onChange={e => set('billToAddress', e.target.value)} /></div>
              <div><L>Quote date</L><input type="date" className="form-input text-sm w-full" value={draft.quoteDate} onChange={e => set('quoteDate', e.target.value)} /></div>
              <div><L>Valid until</L><input type="date" className="form-input text-sm w-full" value={draft.validUntil} onChange={e => set('validUntil', e.target.value)} /></div>
            </div>

            <details className="rounded-lg border border-white/10">
              <summary className="px-3 py-2.5 text-sm text-slate-300 cursor-pointer select-none">Business details &amp; terms</summary>
              <div className="p-3 pt-0 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><L>Name</L><input className="form-input text-sm w-full" value={draft.fromName} onChange={e => set('fromName', e.target.value)} /></div>
                  <div><L>Trading as</L><input className="form-input text-sm w-full" value={draft.fromTradingAs} onChange={e => set('fromTradingAs', e.target.value)} /></div>
                  <div><L>ABN</L><input className="form-input text-sm w-full" value={draft.fromAbn} onChange={e => set('fromAbn', e.target.value)} /></div>
                  <div><L>Phone</L><input className="form-input text-sm w-full" value={draft.fromPhone} onChange={e => set('fromPhone', e.target.value)} /></div>
                  <div className="col-span-2"><L>Email</L><input className="form-input text-sm w-full" value={draft.fromEmail} onChange={e => set('fromEmail', e.target.value)} /></div>
                  <div className="col-span-2"><L>Address</L><input className="form-input text-sm w-full" value={draft.fromAddress} onChange={e => set('fromAddress', e.target.value)} /></div>
                </div>
                <div><L>Terms &amp; conditions</L><textarea className="form-input text-sm w-full resize-none" rows={4} value={draft.termsText} onChange={e => set('termsText', e.target.value)} /></div>
                <div><L>Note to customer (optional)</L><textarea className="form-input text-sm w-full resize-none" rows={2} value={draft.notes} onChange={e => set('notes', e.target.value)} /></div>
              </div>
            </details>
          </div>

          {/* Live preview */}
          <div className={`p-4 bg-navy-900/40 lg:w-1/2 ${tab === 'form' ? 'hidden lg:block' : ''}`}>
            <div className="rounded-lg overflow-hidden ring-1 ring-white/10">
              <QuotePreview quote={previewData} />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex-shrink-0 space-y-2">
          <button onClick={save} disabled={saving} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer">
            {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />} {saved ? 'Save changes' : 'Save quote'}
          </button>
          {saved && (
            <div className="grid grid-cols-3 gap-2">
              <button onClick={copyText} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/10 text-slate-200 hover:text-white hover:border-sky-400/40 text-sm font-semibold cursor-pointer"><Copy className="w-4 h-4" /> Copy</button>
              <button onClick={shareLink} className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/10 text-slate-200 hover:text-white hover:border-sky-400/40 text-sm font-semibold cursor-pointer"><ShareIcon className="w-4 h-4" /> Share</button>
              <a href={`/quote/${saved.token}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-white/10 text-slate-200 hover:text-white hover:border-sky-400/40 text-sm font-semibold cursor-pointer"><ExternalLink className="w-4 h-4" /> Open</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
