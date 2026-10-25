'use client';

// Customer portal card on a recurring profile: the link + PIN to give the
// customer, whether they've signed their agreement (and the signed copy), and
// any book/reschedule requests they've sent from the portal.
import { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { KeyRound, Copy, Share2, RefreshCw, ScrollText, Check, X, CalendarClock, CalendarPlus, Undo2 } from 'lucide-react';
import type { RecurringJob } from '@/lib/db';

const ymd = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

export default function PortalPanel({ job, onJob }: { job: RecurringJob; onJob: (j: RecurringJob) => void }) {
  const [busy, setBusy] = useState(false);
  const [showContract, setShowContract] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const p = job.portal;
  if (!p) return null;

  const link = `${typeof window !== 'undefined' ? window.location.origin : 'https://glassandblast.com.au'}/portal/${p.token}`;
  const first = job.name.split(' ')[0];
  const message = `Hi ${first}, here's your Glass & Blast account: ${link}\nYour PIN is ${p.pin}. You'll be asked to sign your service agreement the first time you log in.`;

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
    catch { toast.error('Copy failed'); }
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) { try { await nav.share({ text: message }); } catch { /* dismissed */ } }
    else copy(message, 'Message');
  };
  const post = async (body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/recurring/${job.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error();
      onJob((await res.json()).job);
      return true;
    } catch { toast.error('Something went wrong'); return false; }
    finally { setBusy(false); }
  };
  const newPin = async () => {
    if (!window.confirm(`Give ${first} a new PIN? Their old PIN stops working and they'll be logged out.`)) return;
    if (await post({ action: 'new-pin' })) toast.success('New PIN made');
  };

  const open = p.requests.filter(r => !r.doneAt);
  const done = p.requests.filter(r => r.doneAt).slice(0, 10);
  const c = p.contract;

  return (
    <div className="mb-6 rounded-lg border border-white/10 bg-navy-800 p-4">
      <h2 className="text-white font-semibold text-sm flex items-center gap-2 mb-3"><KeyRound className="w-4 h-4 text-amber-300" /> Customer portal</h2>

      <div className="flex items-center gap-3 mb-3">
        <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
          <div className="text-slate-500 text-[10px] uppercase tracking-wide">PIN</div>
          <div className="text-white font-mono text-2xl font-bold tracking-[0.3em]">{p.pin}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-slate-500 text-[10px] uppercase tracking-wide">Link</div>
          <div className="text-slate-300 text-xs truncate">{link}</div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            <button onClick={() => copy(link, 'Link')} className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold cursor-pointer"><Copy className="w-3.5 h-3.5" /> Link</button>
            <button onClick={newPin} disabled={busy} className="inline-flex items-center gap-1 text-slate-400 hover:text-white text-xs font-semibold cursor-pointer disabled:opacity-50"><RefreshCw className="w-3.5 h-3.5" /> New PIN</button>
          </div>
        </div>
      </div>
      <button onClick={share} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/15 text-sm font-semibold cursor-pointer touch-manipulation">
        <Share2 className="w-4 h-4" /> Send link + PIN to {first}
      </button>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-3">
        {c ? (
          <>
            <span className="text-emerald-300 text-sm flex items-center gap-1.5"><Check className="w-4 h-4" /> Agreement signed {new Date(c.signedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button onClick={() => setShowContract(true)} className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300 text-xs font-semibold cursor-pointer"><ScrollText className="w-3.5 h-3.5" /> View</button>
          </>
        ) : (
          <span className="text-amber-300/90 text-sm">Agreement not signed yet</span>
        )}
      </div>

      {open.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          <div className="text-white text-sm font-semibold">Requests from {first}</div>
          {open.map(r => (
            <div key={r.id} className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3">
              <div className="text-amber-100 text-sm font-medium flex items-center gap-1.5">
                {r.type === 'book' ? <CalendarPlus className="w-4 h-4" /> : <CalendarClock className="w-4 h-4" />}
                {r.type === 'book' ? 'New clean' : 'Reschedule'}: {ymd(r.preferredDate)}{r.preferredTime ? ` · ${r.preferredTime}` : ''}
              </div>
              {r.note && <div className="text-amber-100/80 text-xs mt-1 whitespace-pre-wrap">{r.note}</div>}
              <div className="text-amber-200/60 text-[11px] mt-1">Sent {new Date(r.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</div>
              <div className="mt-2 flex items-center gap-4">
                {r.bookingId && (
                  <Link href={`/admin/bookings/${r.bookingId}?from=${encodeURIComponent(`/admin/recurring/${job.id}`)}`} className="text-sky-300 hover:text-sky-200 text-xs font-semibold">
                    {r.type === 'book' ? 'Open the new job' : 'Open the job to move'}
                  </Link>
                )}
                <button onClick={() => post({ action: 'request-done', requestId: r.id })} disabled={busy} className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200 text-xs font-semibold cursor-pointer disabled:opacity-50">
                  <Check className="w-3.5 h-3.5" /> Done
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowDone(v => !v)} className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer">{showDone ? 'Hide' : 'Show'} handled requests ({done.length})</button>
          {showDone && (
            <ul className="mt-2 space-y-1">
              {done.map(r => (
                <li key={r.id} className="text-slate-500 text-xs flex items-center justify-between gap-2">
                  <span>{r.type === 'book' ? 'New clean' : 'Reschedule'} · {ymd(r.preferredDate)}</span>
                  <button onClick={() => post({ action: 'request-done', requestId: r.id, done: false })} className="inline-flex items-center gap-1 hover:text-slate-300 cursor-pointer"><Undo2 className="w-3 h-3" /> Reopen</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showContract && c && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={() => setShowContract(false)}>
          <div className="bg-white text-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90svh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-semibold">Signed agreement · {job.name}</h3>
              <button onClick={() => setShowContract(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-y-auto p-5 text-sm leading-relaxed">
              <pre className="whitespace-pre-wrap font-sans">{c.text}</pre>
              <div className="mt-6 pt-4 border-t border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.signature} alt="Signature" className="h-20 w-auto" />
                <div className="font-semibold">{c.signerName}</div>
                <div className="text-slate-500 text-xs mt-1">
                  Signed {new Date(c.signedAt).toLocaleString('en-AU', { dateStyle: 'long', timeStyle: 'medium' })} · IP {c.ip}<br />
                  Term starts {c.termStart} · {c.terms.termMonths} months · {c.terms.cancelFeePercent}% cancel fee{c.terms.feeFirstTermOnly ? ' (first term only)' : ''} · {c.terms.coolingOffDays} business day cooling-off<br />
                  {c.userAgent}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
