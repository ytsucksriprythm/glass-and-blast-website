'use client';

import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { X, Check, Copy, Share as ShareIcon, ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { Booking } from '@/lib/db';
import {
  type Quote, type QuoteInput, type QuoteStatus, type QuoteOtherLine,
  QUOTE_SERVICE_OPTIONS, QUOTE_EXTRA_OPTIONS, QUOTE_VALID_DAYS,
  DEFAULT_QUOTE_TERMS, DEFAULT_QUOTE_ASSUMPTIONS, DEFAULT_PAYMENT_DUE_TERMS, PAYMENT_DUE_TERMS_OPTIONS, type PaymentDueTerms,
  addDays, buildQuoteText, quoteTotal, money, emptyOtherLine,
} from '@/lib/quote';
import { BUSINESS_DEFAULTS, type BusinessProfile } from '@/lib/invoice';
import type { AppSettings } from '@/lib/settings';
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
    itemAmounts: {},
    otherLines: [],
    amount: 0,
    scope: '',
    assumptions: DEFAULT_QUOTE_ASSUMPTIONS,
    paymentTerms: DEFAULT_PAYMENT_DUE_TERMS,
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

  // Business-info profiles + the autofill setting — same source Settings ->
  // "Invoice & quote autofill" writes to, so quotes and invoices always agree
  // on who the "from" defaults to.
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [businessProfiles, setBusinessProfiles] = useState<BusinessProfile[]>([]);
  const [newBusinessProfileOpen, setNewBusinessProfileOpen] = useState(false);
  const [newBusinessProfileName, setNewBusinessProfileName] = useState('');
  const [savingBusinessProfile, setSavingBusinessProfile] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, bRes] = await Promise.all([fetch('/api/admin/settings'), fetch('/api/admin/business-profiles')]);
        if (sRes.ok) setSettings(await sRes.json());
        if (bRes.ok) setBusinessProfiles(await bRes.json());
      } catch { /* selector/autofill just won't apply */ }
    })();
  }, []);

  // New quote only: once settings + profiles have loaded, seed the "from"
  // block per Settings -> Invoice & quote autofill. Runs once.
  const seededAutofill = useRef(false);
  useEffect(() => {
    if (initial || seededAutofill.current) return;
    if (!settings || businessProfiles.length === 0) return;
    seededAutofill.current = true;
    if (settings.autofillBusinessInfo) {
      const p = businessProfiles[0];
      setDraft(d => ({ ...d, fromName: p.fromName, fromTradingAs: p.fromTradingAs, fromAbn: p.fromAbn, fromAddress: p.fromAddress, fromEmail: p.fromEmail, fromPhone: p.fromPhone }));
    } else {
      setDraft(d => ({ ...d, fromName: '', fromTradingAs: '', fromAbn: '', fromAddress: '', fromEmail: '', fromPhone: '' }));
    }
  }, [initial, settings, businessProfiles]);

  const applyBusinessProfile = (p: BusinessProfile) =>
    setDraft(d => ({ ...d, fromName: p.fromName, fromTradingAs: p.fromTradingAs, fromAbn: p.fromAbn, fromAddress: p.fromAddress, fromEmail: p.fromEmail, fromPhone: p.fromPhone }));
  const activeBusinessProfileId = businessProfiles.find(p =>
    p.fromName === draft.fromName && p.fromTradingAs === draft.fromTradingAs && p.fromAbn === draft.fromAbn &&
    p.fromAddress === draft.fromAddress && p.fromEmail === draft.fromEmail && p.fromPhone === draft.fromPhone,
  )?.id;
  const applyOtherBusiness = () => setDraft(d => ({ ...d, fromName: '', fromTradingAs: '', fromAbn: '', fromAddress: '', fromEmail: '', fromPhone: '' }));
  const isOtherBusiness = !activeBusinessProfileId && !draft.fromName && !draft.fromTradingAs && !draft.fromAbn && !draft.fromAddress && !draft.fromEmail && !draft.fromPhone;

  const saveNewBusinessProfile = async () => {
    const name = newBusinessProfileName.trim();
    if (!name) { toast.error('Profile name is required'); return; }
    setSavingBusinessProfile(true);
    try {
      const res = await fetch('/api/admin/business-profiles', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fromName: draft.fromName, fromTradingAs: draft.fromTradingAs, fromAbn: draft.fromAbn, fromAddress: draft.fromAddress, fromEmail: draft.fromEmail, fromPhone: draft.fromPhone }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const created: BusinessProfile = await res.json();
      setBusinessProfiles(ps => [...ps, created]);
      setNewBusinessProfileOpen(false); setNewBusinessProfileName('');
      toast.success(`Profile "${created.name}" saved`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed'); }
    finally { setSavingBusinessProfile(false); }
  };

  const deleteBusinessProfile = async (p: BusinessProfile) => {
    if (p.builtin) return;
    if (!window.confirm(`Delete business profile "${p.name}"?`)) return;
    const res = await fetch(`/api/admin/business-profiles/${p.id}`, { method: 'DELETE' });
    if (res.ok) { setBusinessProfiles(ps => ps.filter(x => x.id !== p.id)); toast.success('Profile deleted'); }
    else toast.error('Delete failed');
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));
  const toggleList = (key: 'services' | 'extras', value: string) => setDraft(d => {
    const list = d[key];
    const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value];
    return { ...d, [key]: next };
  });
  const setItemAmount = (key: string, value: number) => setDraft(d => ({ ...d, itemAmounts: { ...d.itemAmounts, [key]: value } }));
  const addOtherLine = () => setDraft(d => ({ ...d, otherLines: [...d.otherLines, emptyOtherLine()] }));
  const updateOtherLine = (id: string, patch: Partial<QuoteOtherLine>) =>
    setDraft(d => ({ ...d, otherLines: d.otherLines.map(l => l.id === id ? { ...l, ...patch } : l) }));
  const removeOtherLine = (id: string) => setDraft(d => ({ ...d, otherLines: d.otherLines.filter(l => l.id !== id) }));
  const total = quoteTotal(draft);

  const save = async () => {
    if (draft.services.length === 0 && draft.extras.length === 0 && !draft.otherLines.some(l => l.description.trim())) {
      toast.error('Check at least one service, extra, or add an Other line');
      return;
    }
    setSaving(true);
    try {
      const url = saved ? `/api/admin/quotes/${saved.id}` : '/api/admin/quotes';
      const method = saved ? 'PATCH' : 'POST';
      const payload = { ...draft, amount: quoteTotal(draft) };
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
    catch { toast.error('Copy failed, select the text manually'); }
  };

  const shareLink = async () => {
    if (!saved) return;
    const url = `${window.location.origin}/quote/${saved.token}`;
    const title = `Quote ${saved.number} · ${saved.fromTradingAs}`;
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
            {saved ? `${saved.number} · quote` : 'New quote'}
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
              <div className="space-y-1.5">
                {QUOTE_SERVICE_OPTIONS.map(o => {
                  const active = draft.services.includes(o.key);
                  return (
                    <label key={o.key} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${active ? 'border-sky-400 bg-sky-400/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
                      <input type="checkbox" checked={active} onChange={() => toggleList('services', o.key)} className="w-4 h-4 flex-shrink-0 accent-sky-500 cursor-pointer" />
                      <span className={`flex-1 text-sm font-medium ${active ? 'text-white' : 'text-slate-300'}`}>{o.label}</span>
                      {active && (
                        <span className="relative flex-shrink-0 w-24">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                          <input
                            className="form-input pl-6 py-1.5 text-sm w-full" inputMode="decimal" placeholder="0"
                            value={draft.itemAmounts[o.key] || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setItemAmount(o.key, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                          />
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <L>Extras</L>
              <div className="space-y-1.5">
                {QUOTE_EXTRA_OPTIONS.map(o => {
                  const active = draft.extras.includes(o.key);
                  return (
                    <label key={o.key} className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${active ? 'border-sky-400 bg-sky-400/15' : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
                      <input type="checkbox" checked={active} onChange={() => toggleList('extras', o.key)} className="w-4 h-4 flex-shrink-0 accent-sky-500 cursor-pointer" />
                      <span className={`flex-1 text-sm font-medium ${active ? 'text-white' : 'text-slate-300'}`}>{o.label}</span>
                      {active && (
                        <span className="relative flex-shrink-0 w-24">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                          <input
                            className="form-input pl-6 py-1.5 text-sm w-full" inputMode="decimal" placeholder="0"
                            value={draft.itemAmounts[o.key] || ''}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setItemAmount(o.key, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)}
                          />
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <L>Other (anything not covered above)</L>
              <div className="space-y-2">
                {draft.otherLines.map(line => (
                  <div key={line.id} className="flex items-start gap-2">
                    <input
                      className="form-input text-sm w-full" placeholder="e.g. Clean upstairs balcony glass only"
                      value={line.description}
                      onChange={e => updateOtherLine(line.id, { description: e.target.value })}
                    />
                    <span className="relative flex-shrink-0 w-24">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                      <input
                        className="form-input pl-6 py-2 text-sm w-full" inputMode="decimal" placeholder="0"
                        value={line.amount || ''}
                        onChange={e => updateOtherLine(line.id, { amount: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })}
                      />
                    </span>
                    <button type="button" onClick={() => removeOtherLine(line.id)} className="flex-shrink-0 p-2.5 text-slate-500 hover:text-red-400 cursor-pointer" title="Remove line">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={addOtherLine} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-white/15 text-slate-300 hover:text-white hover:border-white/30 text-sm font-medium cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> {draft.otherLines.length ? 'Add another line' : 'Add a line'}
                </button>
              </div>
            </div>

            <div>
              <L>Scope of work</L>
              <textarea className="form-input text-sm w-full resize-none" rows={2} value={draft.scope} onChange={e => set('scope', e.target.value)} placeholder="e.g. 12 windows, single storey, interior &amp; exterior, excludes flyscreens" />
              <p className="text-slate-500 text-xs mt-1">Exactly what's included, so there's no dispute later about how many windows/areas were quoted.</p>
            </div>

            <div>
              <L>Assumptions this quote is based on</L>
              <textarea className="form-input text-sm w-full resize-none" rows={2} value={draft.assumptions} onChange={e => set('assumptions', e.target.value)} placeholder="e.g. Assumed ground-level access, no extreme buildup" />
            </div>

            <div>
              <L>Payment terms</L>
              <select className="form-input text-sm w-full" value={draft.paymentTerms} onChange={e => set('paymentTerms', e.target.value as PaymentDueTerms)}>
                {PAYMENT_DUE_TERMS_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <p className="text-slate-500 text-xs mt-1">Cash on completion, or bank transfer against the invoice — this is just how long they get to pay it. Carries over to autofill the invoice if you make one from this booking.</p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 flex items-center justify-between">
              <span className="text-slate-400 text-sm">Total (from items above)</span>
              <span className="text-white font-bold text-lg">{money(total)}</span>
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
                {businessProfiles.length > 1 && (
                  <div>
                    <p className="text-xs text-slate-500 mb-2">Pick which identity this quote is from. Fields below stay editable for one-offs.</p>
                    <div className="flex flex-wrap gap-2">
                      {businessProfiles.map(p => {
                        const on = activeBusinessProfileId === p.id;
                        return (
                          <span key={p.id} className={`inline-flex items-center rounded-lg border text-sm font-medium ${on ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>
                            <button type="button" onClick={() => applyBusinessProfile(p)} className="pl-3 pr-2 py-2 cursor-pointer">{p.name}</button>
                            {!p.builtin && (
                              <button type="button" onClick={() => deleteBusinessProfile(p)} title="Delete profile" className="pr-2 text-slate-500 hover:text-red-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                            )}
                          </span>
                        );
                      })}
                      <button type="button" onClick={applyOtherBusiness} className={`px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer ${isOtherBusiness ? 'border-sky-400 bg-sky-400/15 text-white' : 'border-white/10 text-slate-300'}`}>Other</button>
                      <button type="button" onClick={() => setNewBusinessProfileOpen(v => !v)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-dashed border-white/15 text-slate-300 hover:text-white text-sm font-medium cursor-pointer"><Plus className="w-3.5 h-3.5" /> New profile</button>
                    </div>
                  </div>
                )}
                {newBusinessProfileOpen && businessProfiles.length > 1 && (
                  <div className="rounded-lg border border-sky-400/30 bg-sky-400/5 p-3">
                    <p className="text-xs text-slate-400 mb-2">Set the fields below, then name and save them as a reusable profile.</p>
                    <div className="flex items-center gap-2">
                      <input className="form-input text-sm flex-1" placeholder="Profile name (e.g. Liam)" value={newBusinessProfileName} onChange={e => setNewBusinessProfileName(e.target.value)} />
                      <button onClick={saveNewBusinessProfile} disabled={savingBusinessProfile} className="px-3 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer whitespace-nowrap">Save profile</button>
                      <button onClick={() => { setNewBusinessProfileOpen(false); setNewBusinessProfileName(''); }} className="p-2.5 text-slate-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                )}
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
