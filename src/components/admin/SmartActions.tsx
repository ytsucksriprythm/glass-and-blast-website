'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import type { SmartAction, SmartActionRecord } from '@/lib/smartActionTypes';

type PreviewAction = SmartAction & { preview: string };
type Overview = { actions: PreviewAction[]; welcome: string; smsEnabled: boolean };

export default function SmartActions() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ headline: string; details?: string[]; error?: boolean } | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/admin/smart-actions', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Could not load Smart Actions.');
      const next: Overview = await response.json();
      if (!signal?.aborted) setOverview(next);
    } catch {
      if (!signal?.aborted) setFeedback(current => current ?? { headline: 'Could not load Smart Actions.', error: true });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const update = () => { if (!document.hidden) void refresh(controller.signal); };
    update();
    const timer = window.setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh]);

  async function respond(action: PreviewAction, operation: 'approve' | 'dismiss') {
    if (busy) return;
    setBusy(action.id);
    setFeedback(null);
    try {
      const response = await fetch('/api/admin/smart-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: action.id, operation, preview: action.preview }),
      });
      const payload: { result?: SmartActionRecord; error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not complete this action.');
      const result = payload.result;
      const headline = result?.status === 'executing' ? 'This action is already being processed.'
        : result?.status === 'dismissed' || !result ? 'Suggestion dismissed.'
        : result.status === 'failed' ? 'Some actions need attention.'
        : result.results.some(row => row.status === 'queued') ? 'SMS queued.' : 'Action completed.';
      setFeedback({
        headline, error: result?.status === 'failed',
        details: result?.results.map((row, index) => `${action.recipients[index]?.name ?? 'Recipient'} · ${row.detail}`),
      });
      setExpanded(null);
    } catch (error) {
      setFeedback({ headline: error instanceof Error ? error.message : 'Could not complete this action.', error: true });
    } finally {
      await refresh();
      setBusy(null);
    }
  }

  const actions = overview?.actions ?? [];
  return <section aria-labelledby="smart-actions-heading" className="rounded-xl border border-white/10 bg-navy-800 px-4 py-3">
    <header className="flex items-center justify-between gap-3">
      <h2 id="smart-actions-heading" className="font-semibold text-white">Smart Actions</h2>
      {actions.length > 4 && <button type="button" onClick={() => setShowAll(value => !value)}
        className="min-h-11 px-2 text-sm text-sky-300">{showAll ? 'Show fewer' : `View all (${actions.length})`}</button>}
    </header>
    {feedback && <div role={feedback.error ? 'alert' : 'status'} className={'py-2 text-sm ' + (feedback.error ? 'text-red-300' : 'text-emerald-200')}>
      <p>{feedback.headline}</p>
      {feedback.details?.length ? <ul className="mt-1 space-y-1">{feedback.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul> : null}
    </div>}
    {!overview && !feedback && <p role="status" className="py-2 text-sm text-slate-300">Checking for actions…</p>}
    {overview && !actions.length && <p className="py-2 text-sm text-slate-300">No actions to review.</p>}
    {overview && actions.length > 0 && !overview.smsEnabled &&
      <p className="py-2 text-sm text-amber-200">SMS sending is disabled.</p>}
    <ul className="divide-y divide-white/10">
      {(showAll ? actions : actions.slice(0, 4)).map(action => {
        const open = expanded === action.id;
        return <li key={action.id} className="py-2">
          <div className="flex items-start gap-2">
            <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : action.id)}
              className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-lg py-1 text-left">
              <ChevronDown aria-hidden="true" className={'mt-0.5 size-4 shrink-0 text-slate-300 ' + (open ? 'rotate-180' : '')} />
              <span className="min-w-0">
                <span className="block break-words text-sm font-semibold text-white">{action.title}</span>
                <span className="block text-xs text-slate-300">{action.description}</span>
              </span>
            </button>
            <button type="button" aria-label={`Approve ${action.title}`} title={action.bulk ? 'Review recipients' : 'Approve'}
              disabled={!!busy || !overview?.smsEnabled}
              onClick={() => action.bulk ? setExpanded(action.id) : void respond(action, 'approve')}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-40">
              <Check aria-hidden="true" className="size-5" />
            </button>
            <button type="button" aria-label={`Dismiss ${action.title}`} title="Dismiss" disabled={!!busy}
              onClick={() => void respond(action, 'dismiss')}
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-red-300 hover:bg-red-400/10 disabled:opacity-40">
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          {open && <div className="space-y-2 rounded-lg bg-navy-900/60 p-3 text-sm">
            {action.customerSms && <div className="space-y-1 border-b border-white/10 pb-2">
              <p className="text-xs font-semibold text-slate-300">Customer message</p>
              <p className="whitespace-pre-wrap break-words text-white">{action.customerSms}</p>
            </div>}
            {action.recipients.map(recipient => <div key={recipient.phone} className="space-y-1">
              <p className="break-words font-semibold text-white">{recipient.name} · {recipient.phone}</p>
              <p className="whitespace-pre-wrap break-words text-slate-300">{recipient.message}</p>
            </div>)}
            <details className="text-xs text-slate-300">
              <summary className="min-h-8 cursor-pointer text-sky-300">First-contact welcome notice</summary>
              <p className="whitespace-pre-wrap">{overview?.welcome}</p>
            </details>
            {action.bulk && <button type="button" disabled={!!busy || !overview?.smsEnabled}
              onClick={() => void respond(action, 'approve')}
              className="min-h-11 rounded-lg bg-emerald-400/15 px-3 font-semibold text-emerald-200 disabled:opacity-40">
              Send {action.recipients.length} follow-up {action.recipients.length === 1 ? 'SMS' : 'texts'}
            </button>}
          </div>}
        </li>;
      })}
    </ul>
  </section>;
}
