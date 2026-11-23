'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { SmartAction, SmartActionRecord } from '@/lib/smartActionTypes';

type Suggestion = SmartAction & { preview: string };

export default function ConversationSmartActions({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<Suggestion[]>([]);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState('');
  const request = useRef<AbortController | null>(null);

  const update = useCallback(async (refresh = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setWorking(true);
    setFeedback('');
    try {
      const response = await fetch('/api/admin/smart-actions?' + new URLSearchParams({ phone, ...(refresh && { refresh: '1' }) }), {
        cache: 'no-store', signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check this conversation.');
      if (controller.signal.aborted) return;
      setActions(data.actions);
      setSmsEnabled(data.smsEnabled);
      if (!data.actions.length) setFeedback('No action suggested for this conversation.');
    } catch (error) {
      if (!controller.signal.aborted) setFeedback(error instanceof Error ? error.message : 'Could not check this conversation.');
    } finally {
      if (!controller.signal.aborted) setWorking(false);
    }
  }, [phone]);

  useEffect(() => {
    if (open) void update();
    return () => request.current?.abort();
  }, [open, update]);

  async function respond(action: Suggestion, operation: 'approve' | 'dismiss') {
    setWorking(true);
    setFeedback('');
    try {
      const response = await fetch('/api/admin/smart-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: action.id, preview: action.preview, operation, phone }),
      });
      const data: { result?: SmartActionRecord; error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not complete the action.');
      setActions(items => items.filter(item => item.id !== action.id));
      setFeedback(operation === 'dismiss' ? 'Suggestion denied.' :
        data.result?.results.map(result => result.detail).join(' ') || 'Action is already being processed.');
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not complete the action.');
    } finally {
      setWorking(false);
    }
  }

  return <div className="max-w-[90%]">
    <button type="button" aria-label="Message Smart Actions" aria-expanded={open}
      onClick={() => setOpen(value => !value)}
      className="mt-0.5 flex h-8 w-9 items-center justify-center rounded-md bg-navy-900/70 text-slate-400 hover:bg-navy-800 hover:text-slate-200 focus-visible:outline focus-visible:outline-sky-400">
      <ChevronDown aria-hidden="true" className={'size-4 transition-transform ' + (open ? 'rotate-180' : '')} />
    </button>
    {open && <div className="w-72 max-w-full space-y-2 rounded-lg border border-white/10 bg-navy-900 p-2.5 text-xs">
      <button type="button" onClick={() => void update(true)} disabled={working}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-60">
        <RefreshCw aria-hidden="true" className="size-3.5" /> {working ? 'Checking…' : 'AI update'}
      </button>
      {feedback && <p role="status" className="text-slate-300">{feedback}</p>}
      {actions.map(action => <div key={action.id} className="space-y-2 border-t border-white/10 pt-2">
        <p className="text-slate-200">{action.description}</p>
        {action.recipients[0]?.message && <p className="whitespace-pre-wrap break-words rounded-md bg-white/5 p-2 text-slate-300">{action.recipients[0].message}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void respond(action, 'approve')}
            disabled={working || (!action.calendarOnly && !smsEnabled)}
            className="min-h-9 rounded-md bg-emerald-400/15 px-2 font-semibold text-emerald-200 disabled:opacity-50">
            {action.calendarOnly || action.kind === 'send-invoice' || action.kind === 'send-quote' ? action.title : 'Approve and send'}
          </button>
          <button type="button" onClick={() => void respond(action, 'dismiss')} disabled={working}
            className="min-h-9 rounded-md px-2 text-slate-300 hover:bg-white/10 disabled:opacity-50">Deny</button>
        </div>
      </div>)}
    </div>}
  </div>;
}
