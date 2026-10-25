'use client';

// Recurring customer portal. Flow: PIN → "Welcome, [name]" → (first time only)
// sign the service agreement → dashboard with upcoming jobs, book / reschedule
// requests, invoices, quotes and a copy of the signed agreement.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import {
  Lock, CalendarDays, CalendarPlus, FileText, Receipt, ScrollText, LogOut, Check, X, Clock, Repeat, ChevronRight, Printer, AlertCircle,
} from 'lucide-react';
import SignaturePad from '@/components/SignaturePad';
import type { PortalView } from '@/lib/portal';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window cleaning', 'pressure-washing': 'Pressure washing', both: 'Windows + pressure washing',
  'flyscreen-repair': 'Flyscreen repair', 'solar-panel-cleaning': 'Solar panel cleaning', other: 'Other',
};
const serviceText = (s: string) => (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || 'Clean';
const STATUS: Record<string, { label: string; cls: string }> = {
  uncontacted: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  contacted: { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  'quote-booked': { label: 'Requested', cls: 'bg-amber-100 text-amber-800' },
  quoted: { label: 'Quoted', cls: 'bg-violet-100 text-violet-800' },
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-100 text-emerald-800' },
  completed: { label: 'Done', cls: 'bg-slate-100 text-slate-600' },
};
const money = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const ymdLabel = (ymd: string) => new Date(`${ymd}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const jobWhen = (j: PortalView['upcoming'][number]) => j.scheduledAt
  ? new Date(j.scheduledAt).toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
  : j.preferredDate ? `Date to be confirmed (you asked for ${ymdLabel(j.preferredDate)})` : 'Date to be confirmed';
const todayPlus = (days: number) => { const d = new Date(Date.now() + days * 86400000); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const TIME_OPTIONS = ['Any time', 'Morning', 'Afternoon'];

type Stage = 'loading' | 'pin' | 'welcome' | 'contract' | 'dashboard' | 'agreement';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100svh] bg-slate-50 text-slate-900">
      <header className="no-print bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2.5">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded" />
          <span className="font-display font-bold text-slate-900">Glass &amp; Blast</span>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-6 sm:py-10">{children}</div>
    </main>
  );
}

function Btn({ children, onClick, disabled, variant = 'primary', className = '' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'primary' | 'ghost'; className?: string }) {
  const v = variant === 'primary'
    ? 'bg-sky-600 hover:bg-sky-500 text-white'
    : 'bg-white border border-slate-300 hover:border-slate-400 text-slate-700';
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 cursor-pointer touch-manipulation ${v} ${className}`}>
      {children}
    </button>
  );
}

function Agreement({ v }: { v: PortalView }) {
  return (
    <article className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 sm:p-8">
      <h2 className="font-display text-xl sm:text-2xl font-bold text-slate-900 mb-1">{v.contract.title}</h2>
      <p className="text-slate-500 text-sm mb-6">{v.contract.signed ? 'Your signed copy.' : 'Please read this before signing. It\'s written in plain English.'}</p>
      <div className="space-y-5 text-[15px] leading-relaxed text-slate-700">
        {v.contract.sections.map(s => (
          <section key={s.heading}>
            <h3 className="font-semibold text-slate-900 mb-1.5">{s.heading}</h3>
            {s.body.map((p, i) => <p key={i} className="mb-2 last:mb-0">{p}</p>)}
          </section>
        ))}
      </div>
      {v.contract.signed && v.contract.signature && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <div className="text-slate-500 text-xs uppercase tracking-wide font-semibold mb-2">Signed</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={v.contract.signature} alt={`Signature of ${v.contract.signerName}`} className="h-24 w-auto" />
          <div className="text-slate-900 font-semibold">{v.contract.signerName}</div>
          <div className="text-slate-500 text-sm">{v.contract.signedAt ? new Date(v.contract.signedAt).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'short' }) : ''}</div>
        </div>
      )}
    </article>
  );
}

export default function PortalPage() {
  const { token } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>('loading');
  const [view, setView] = useState<PortalView | null>(null);
  const [firstName, setFirstName] = useState('');

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [checking, setChecking] = useState(false);

  const [signerName, setSignerName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  // Book / reschedule request sheet
  const [sheet, setSheet] = useState<null | { type: 'book' } | { type: 'reschedule'; bookingId: string; when: string }>(null);
  const [req, setReq] = useState({ date: todayPlus(7), time: 'Any time', note: '' });
  const [sending, setSending] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(async (): Promise<PortalView | null> => {
    const res = await fetch(`/api/portal/${token}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v: PortalView = await res.json();
    setView(v);
    setFirstName(v.firstName);
    return v;
  }, [token]);

  // Returning visitor with a live session skips the PIN.
  useEffect(() => {
    load().then(v => setStage(v ? (v.contract.signed ? 'dashboard' : 'contract') : 'pin')).catch(() => setStage('pin'));
  }, [load]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); } }, [toast]);
  // Each step (contract → dashboard → agreement) starts at the top of the page.
  useEffect(() => { window.scrollTo({ top: 0 }); }, [stage]);

  const submitPin = async (value = pin) => {
    if (value.length !== 4 || checking) return;
    setChecking(true);
    setPinError('');
    try {
      const res = await fetch(`/api/portal/${token}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPinError(data.error || 'Something went wrong'); setPin(''); return; }
      setFirstName(data.firstName);
      setStage('welcome');
      const v = await load();
      setTimeout(() => setStage(v?.contract.signed ? 'dashboard' : 'contract'), 1800);
    } finally { setChecking(false); }
  };

  const sign = async () => {
    setSignError('');
    if (!agree) { setSignError('Tick the box to say you agree.'); return; }
    if (signerName.trim().length < 2) { setSignError('Type your full name.'); return; }
    if (!signature) { setSignError('Draw your signature in the box.'); return; }
    setSigning(true);
    try {
      const res = await fetch(`/api/portal/${token}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerName: signerName.trim(), signature, agree }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) { setSignError(data.error || 'Could not sign, please try again.'); return; }
      await load();
      setStage('dashboard');
      window.scrollTo({ top: 0 });
      setToast('Thanks! Your agreement is signed.');
    } finally { setSigning(false); }
  };

  const openSheet = (s: NonNullable<typeof sheet>) => { setReq({ date: todayPlus(7), time: 'Any time', note: '' }); setSheetError(''); setSheet(s); };
  const sendRequest = async () => {
    if (!sheet) return;
    if (!req.date) { setSheetError('Pick a date.'); return; }
    setSending(true);
    setSheetError('');
    try {
      const res = await fetch(`/api/portal/${token}/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: sheet.type,
          bookingId: sheet.type === 'reschedule' ? sheet.bookingId : undefined,
          preferredDate: req.date,
          preferredTime: req.time === 'Any time' ? '' : req.time,
          note: req.note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSheetError(data.error || 'Could not send, please try again.'); return; }
      setSheet(null);
      await load();
      setToast(sheet.type === 'book' ? 'Request sent. We\'ll be in touch to confirm the date.' : 'Reschedule request sent. We\'ll confirm the new time with you.');
    } finally { setSending(false); }
  };

  const logout = async () => {
    await fetch(`/api/portal/${token}/logout`, { method: 'POST' });
    setView(null);
    setPin('');
    setStage('pin');
  };

  // ── PIN ──
  if (stage === 'loading') return <Shell><div className="h-40 rounded-2xl bg-slate-200/60 animate-pulse" /></Shell>;

  if (stage === 'pin') {
    return (
      <Shell>
        <div className="max-w-sm mx-auto bg-white rounded-2xl ring-1 ring-slate-200 p-6 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-sky-50 text-sky-600 flex items-center justify-center mb-3"><Lock className="w-5 h-5" /></div>
          <h1 className="font-display text-xl font-bold mb-1">Your Glass &amp; Blast account</h1>
          <p className="text-slate-500 text-sm mb-5">Enter the 4-digit PIN we gave you.</p>
          <input
            className="w-full text-center text-3xl tracking-[0.6em] font-bold py-3 rounded-xl border-2 border-slate-200 focus:border-sky-500 outline-none"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={4}
            value={pin}
            aria-label="4-digit PIN"
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 4);
              setPin(v);
              setPinError('');
              if (v.length === 4) submitPin(v);
            }}
            onKeyDown={e => { if (e.key === 'Enter') submitPin(); }}
          />
          {pinError && <p className="mt-3 text-sm text-red-600 flex items-center justify-center gap-1.5"><AlertCircle className="w-4 h-4" /> {pinError}</p>}
          <Btn onClick={() => submitPin()} disabled={pin.length !== 4 || checking} className="w-full mt-4">
            {checking ? 'Checking…' : 'Continue'}
          </Btn>
          <p className="text-slate-400 text-xs mt-4">Lost your PIN? Call or text us on 0466 050 834.</p>
        </div>
      </Shell>
    );
  }

  if (stage === 'welcome') {
    return (
      <Shell>
        <div className="text-center py-16">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4"><Check className="w-7 h-7" /></div>
          <h1 className="font-display text-3xl font-bold">Welcome, {firstName}</h1>
          <p className="text-slate-500 mt-2">Loading your account…</p>
        </div>
      </Shell>
    );
  }

  if (!view) return <Shell><p className="text-slate-500">Something went wrong. Please reload the page.</p></Shell>;

  // ── Contract (first visit) ──
  if (stage === 'contract' && !view.contract.signed) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold mb-1">Hi {view.firstName}, one quick thing first</h1>
        <p className="text-slate-600 mb-5">
          Before we start your {view.plan.cadenceText} plan{view.plan.discount ? ` with $${view.plan.discount} off each clean` : ''}, please read and sign your service agreement. You only need to do this once.
        </p>
        <Agreement v={view} />
        <div className="mt-6 bg-white rounded-2xl ring-1 ring-slate-200 p-5 sm:p-6 space-y-4">
          <h2 className="font-display text-lg font-bold">Sign your agreement</h2>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Your full name</label>
            <input className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-sky-500 outline-none" value={signerName} onChange={e => setSignerName(e.target.value)} placeholder={view.name} autoComplete="name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Your signature</label>
            <SignaturePad onChange={setSignature} />
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5 accent-sky-600 flex-shrink-0" checked={agree} onChange={e => setAgree(e.target.checked)} />
            <span className="text-sm text-slate-700">I have read this agreement, I agree to its terms, and I agree to sign it electronically.</span>
          </label>
          {signError && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {signError}</p>}
          <Btn onClick={sign} disabled={signing} className="w-full">{signing ? 'Signing…' : <><Check className="w-4 h-4" /> Sign agreement</>}</Btn>
        </div>
      </Shell>
    );
  }

  // ── Read-only signed agreement ──
  if (stage === 'agreement') {
    return (
      <Shell>
        <div className="no-print flex items-center justify-between mb-4">
          <Btn variant="ghost" onClick={() => setStage('dashboard')}>← Back</Btn>
          <Btn variant="ghost" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print / save PDF</Btn>
        </div>
        <Agreement v={view} />
      </Shell>
    );
  }

  // ── Dashboard ──
  const openRequests = view.requests;
  const rescheduleFor = (bookingId: string) => openRequests.find(r => r.type === 'reschedule' && r.bookingId === bookingId);

  return (
    <Shell>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Hi {view.firstName}</h1>
          <p className="text-slate-500 text-sm mt-0.5 flex items-center gap-1.5">
            <Repeat className="w-4 h-4 text-sky-600" /> Your plan: {view.plan.cadenceText}{view.plan.discount ? ` · $${view.plan.discount} off each clean` : ''}
          </p>
        </div>
        <button onClick={logout} className="no-print flex-shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 cursor-pointer"><LogOut className="w-4 h-4" /> Log out</button>
      </div>

      <Btn onClick={() => openSheet({ type: 'book' })} className="w-full mb-6"><CalendarPlus className="w-4 h-4" /> Book a clean</Btn>

      {/* Upcoming */}
      <section className="mb-7">
        <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2"><CalendarDays className="w-5 h-5 text-sky-600" /> Upcoming</h2>
        {view.upcoming.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-5 text-slate-500 text-sm">
            Nothing booked yet. Your next clean is due around {ymdLabel(view.plan.nextDate)}, we&apos;ll be in touch to arrange it.
          </div>
        ) : (
          <ul className="space-y-3">
            {view.upcoming.map(j => {
              const st = STATUS[j.status] ?? STATUS.uncontacted;
              const rq = rescheduleFor(j.id);
              return (
                <li key={j.id} className="bg-white rounded-2xl ring-1 ring-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{jobWhen(j)}</div>
                      <div className="text-slate-500 text-sm">{serviceText(j.service)}{j.price ? ` · ${money(j.price)}` : ''}</div>
                    </div>
                    <span className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                  </div>
                  {rq ? (
                    <div className="mt-3 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex items-center gap-2">
                      <Clock className="w-4 h-4 flex-shrink-0" /> Reschedule requested for {ymdLabel(rq.preferredDate)}{rq.preferredTime ? ` (${rq.preferredTime.toLowerCase()})` : ''}. We&apos;ll confirm with you.
                    </div>
                  ) : j.scheduledAt ? (
                    <button onClick={() => openSheet({ type: 'reschedule', bookingId: j.id, when: jobWhen(j) })} className="no-print mt-3 text-sm font-semibold text-sky-700 hover:text-sky-600 cursor-pointer">
                      Need a different day? Request to reschedule
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Invoices + quotes */}
      <section className="mb-7 grid sm:grid-cols-2 gap-4">
        <div>
          <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2"><Receipt className="w-5 h-5 text-sky-600" /> Invoices</h2>
          {view.invoices.length === 0 ? <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-4 text-slate-500 text-sm">No invoices yet.</div> : (
            <ul className="bg-white rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
              {view.invoices.map(i => (
                <li key={i.token}>
                  <a href={`/invoice/${i.token}`} target="_blank" rel="noopener" className="flex items-center gap-3 p-3.5 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm">{i.number} · {money(i.total)}</div>
                      <div className="text-slate-500 text-xs">{ymdLabel(i.date)}</div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${i.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{i.status === 'paid' ? 'Paid' : 'To pay'}</span>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="font-display text-lg font-bold mb-3 flex items-center gap-2"><FileText className="w-5 h-5 text-sky-600" /> Quotes</h2>
          {view.quotes.length === 0 ? <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-4 text-slate-500 text-sm">No quotes yet.</div> : (
            <ul className="bg-white rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
              {view.quotes.map(q => (
                <li key={q.token}>
                  <a href={`/quote/${q.token}`} target="_blank" rel="noopener" className="flex items-center gap-3 p-3.5 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm">{q.number} · {money(q.total)}</div>
                      <div className="text-slate-500 text-xs">{ymdLabel(q.date)}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {view.past.length > 0 && (
        <section className="mb-7">
          <h2 className="font-display text-lg font-bold mb-3">Past cleans</h2>
          <ul className="bg-white rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
            {view.past.map(j => (
              <li key={j.id} className="p-3.5 flex items-center justify-between gap-3 text-sm">
                <span>{j.scheduledAt ? new Date(j.scheduledAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : j.preferredDate ? ymdLabel(j.preferredDate) : ''} · {serviceText(j.service)}</span>
                {j.price ? <span className="text-slate-500">{money(j.price)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button onClick={() => { setStage('agreement'); window.scrollTo({ top: 0 }); }} className="no-print w-full flex items-center gap-3 bg-white rounded-2xl ring-1 ring-slate-200 p-4 text-left hover:bg-slate-50 cursor-pointer">
        <ScrollText className="w-5 h-5 text-sky-600" />
        <span className="flex-1">
          <span className="block font-semibold text-sm">Your service agreement</span>
          <span className="block text-slate-500 text-xs">Signed {view.contract.signedAt ? new Date(view.contract.signedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}</span>
        </span>
        <ChevronRight className="w-4 h-4 text-slate-400" />
      </button>

      <p className="text-center text-slate-400 text-xs mt-8">Questions? Call or text 0466 050 834.</p>

      {/* Request sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setSheet(null)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold">{sheet.type === 'book' ? 'Book a clean' : 'Request to reschedule'}</h3>
              <button onClick={() => setSheet(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            {sheet.type === 'reschedule' && <p className="text-sm text-slate-500">Currently: {sheet.when}</p>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Preferred date</label>
              <input type="date" min={todayPlus(1)} className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-sky-500 outline-none" value={req.date} onChange={e => setReq(r => ({ ...r, date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Time of day</label>
              <div className="grid grid-cols-3 gap-2">
                {TIME_OPTIONS.map(t => (
                  <button key={t} type="button" onClick={() => setReq(r => ({ ...r, time: t }))} className={`py-2.5 rounded-xl border text-sm font-medium cursor-pointer ${req.time === t ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600'}`}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Anything we should know? (optional)</label>
              <textarea rows={2} className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:border-sky-500 outline-none resize-none" value={req.note} onChange={e => setReq(r => ({ ...r, note: e.target.value }))} />
            </div>
            <p className="text-xs text-slate-500">This is a request: we&apos;ll get back to you to confirm the date.</p>
            {sheetError && <p className="text-sm text-red-600">{sheetError}</p>}
            <Btn onClick={sendRequest} disabled={sending} className="w-full">{sending ? 'Sending…' : 'Send request'}</Btn>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 bg-slate-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 max-w-[90vw]">
          <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" /> {toast}
        </div>
      )}
    </Shell>
  );
}
