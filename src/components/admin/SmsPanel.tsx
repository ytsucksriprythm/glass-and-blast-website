'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import Link from 'next/link';
import { australianMobile } from '@/lib/smsTypes';
import type { SmsMessage, SmsPreference } from '@/lib/smsTypes';
import type { Quote } from '@/lib/quote';
import type { Invoice } from '@/lib/invoice';
import { useStaffProfile, writeStaffPreference } from './StaffSession';

type Kind = 'quote' | 'invoice' | 'booking' | 'manual';
type History = { phone: string; messages: SmsMessage[]; preference: SmsPreference | null; enabled: boolean; lastIncomingId?: string };
const unresolved = ['pending', 'retry', 'sending', 'queued', 'accepted', 'unknown'];
const failures = ['failed', 'undelivered', 'unknown', 'canceled'];
const control = 'min-h-11 rounded-lg border border-white/15 px-3 text-sm font-semibold text-sky-300 disabled:opacity-40';

export default function SmsPanel({ kind, recordId, needsApproval = false, onQuoteApproved, onInvoiceApproved, conversation }: {
  kind: Kind; recordId: string; needsApproval?: boolean; onQuoteApproved?: (quote: Quote) => void;
  onInvoiceApproved?: (invoice: Invoice) => void;
  conversation?: { href: string; jobIds: string[] };
}) {
  const profile = useStaffProfile();
  const chat = kind === 'manual';
  const [open, setOpen] = useState(!chat || Boolean(conversation));
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const retry = useRef<{ payload: string; id?: string } | null>(null);
  const thread = useRef<HTMLUListElement>(null);
  const keepAtBottom = useRef(true);
  const params = new URLSearchParams({ kind, recordId }).toString();
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch('/api/admin/sms?' + params, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not load SMS.');
    if (!signal?.aborted) {
      setHistory(result);
      setLoadError('');
      if (chat && !document.hidden && result.lastIncomingId) {
        writeStaffPreference(profile, 'sms-read:' + result.phone, result.lastIncomingId);
      }
    }
  }, [chat, params, profile]);

  useEffect(() => {
    if (!open || !profile || busy) return;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try { await load(controller.signal); }
      catch (err) { if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : 'Could not load SMS.'); }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [open, profile, busy, load]);

  const newest = history?.messages[0]?.id;
  useEffect(() => {
    if (open && keepAtBottom.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [newest, open]);

  if (!profile) return null;
  const sent = history?.messages.filter(message => message.recordId === recordId && message.kind === kind) ?? [];
  const alreadySent = !chat && sent.length > 0;
  const canReply = !conversation || Boolean(history && australianMobile(history.phone));
  const enabled = canReply && history?.enabled && history.preference !== 'opted-out';
  const subject = kind === 'booking' ? 'confirmation' : kind;

  const action = async (operation: 'send' | 'opt-out') => {
    if (!history || busy) return;
    const confirmConsent = operation === 'send' && !history.preference;
    if (confirmConsent && !confirm('Has this customer agreed to receive service SMS from Glass & Blast?')) return;
    if (operation === 'opt-out' && !confirm('Stop sending SMS to this number?')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        action: operation, kind, recordId,
        text: chat && operation === 'send' ? text.trim() : undefined,
        approveQuote: kind === 'quote' && needsApproval,
        approveInvoice: kind === 'invoice' && needsApproval,
      };
      const body = JSON.stringify(payload);
      if (retry.current?.payload !== body) {
        retry.current = { payload: body, id: operation === 'send' && (chat || alreadySent) ? crypto.randomUUID() : undefined };
      }
      const response = await fetch('/api/admin/sms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, confirmConsent, requestId: retry.current.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not send SMS.');
      retry.current = null;
      if (result.approvedQuote) onQuoteApproved?.(result.approvedQuote);
      if (result.approvedInvoice) onInvoiceApproved?.(result.approvedInvoice);
      if (result.message) {
        if (chat) {
          keepAtBottom.current = true;
          setText('');
        } else if (failures.includes(result.message.status)) {
          setError(result.message.error || 'SMS ' + result.message.status + '.');
        } else {
          setNotice('SMS ' + result.message.status + '.');
        }
      }
      if (result.preference) setHistory({ ...history, preference: result.preference });
    } catch (err) { setError(err instanceof Error ? err.message : 'SMS operation failed.'); }
    finally { setBusy(false); }
  };

  const content = <div className={conversation ? 'flex min-h-0 flex-1 flex-col gap-2 p-3' : 'space-y-3'}>
    {!history && !loadError && <p role="status" className="text-sm text-slate-300">Loading SMS…</p>}
    {history && <>
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        {!conversation && <p className="text-sm text-slate-300">{chat ? history.phone : 'To ' + history.phone}</p>}
        {history.preference === 'opted-in' && chat && canReply && <button type="button" className="ml-auto min-h-11 text-xs text-slate-300 disabled:opacity-40" disabled={busy} onClick={() => void action('opt-out')}>Opt out</button>}
      </div>
      {!history.enabled && <p className="text-sm text-amber-200">SMS sending is disabled in this environment.</p>}
      {history.preference === 'opted-out' && <p className="text-sm text-amber-200">This number opted out of SMS.</p>}
      {!canReply && <p className="text-sm text-amber-200">Replies are available for Australian mobile numbers.</p>}
      {chat ? <>
        {history.messages.length ? <ul ref={thread} aria-label="SMS conversation" tabIndex={0}
          onScroll={event => { const list = event.currentTarget; keepAtBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40; }}
          className={(conversation ? 'min-h-0 flex-1 ' : 'max-h-72 ') + 'space-y-3 overflow-y-auto overscroll-contain rounded-lg bg-navy-900/50 p-2'}>
          {[...history.messages].reverse().map(message => {
            const inbound = message.direction === 'inbound';
            return <li key={message.id} className={'flex flex-col ' + (inbound ? 'items-start' : 'items-end')}>
              <p className={'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm text-white ' + (inbound ? 'rounded-bl-sm bg-navy-700' : 'rounded-br-sm bg-sky-800')}>{message.body}</p>
              <div className="mt-1 text-xs text-slate-300">
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'short', timeStyle: 'short' })}</time>
                {!inbound && <span> · {message.status}</span>}
              </div>
              {conversation && message.recordId && conversation.jobIds.includes(message.recordId) &&
                <Link className="inline-flex min-h-11 items-center text-xs font-semibold text-sky-300"
                  href={'/admin/bookings/' + encodeURIComponent(message.recordId) + '?from=' + encodeURIComponent(conversation.href)}>View linked job</Link>}
              {conversation && message.recordId && ['invoice', 'reminder'].includes(message.kind) &&
                <Link className="inline-flex min-h-11 items-center text-xs font-semibold text-sky-300"
                  href={'/admin/invoices/' + encodeURIComponent(message.recordId) + '?from=' + encodeURIComponent(conversation.href)}>View invoice</Link>}
              {message.error && <p className="text-xs text-red-300">{message.error}</p>}
            </li>;
          })}
        </ul> : <p className={'py-3 text-center text-sm text-slate-300 ' + (conversation ? 'flex-1' : '')}>No messages yet.</p>}
        {canReply && <form className="flex shrink-0 items-end gap-2" onSubmit={event => { event.preventDefault(); if (enabled && text.trim()) void action('send'); }}>
          <textarea aria-label="Text message" placeholder="Text message" maxLength={500} rows={2} readOnly={busy}
            className="form-input min-w-0 flex-1 resize-none text-base" value={text} onChange={event => setText(event.target.value)} />
          <button type="submit" aria-label="Send message" disabled={busy || !enabled || !text.trim()} className={control + ' min-w-11'}>
            <Send className="size-4" />
          </button>
        </form>}
      </> : <>
        {alreadySent && <p className="text-sm text-slate-300">Latest SMS · {sent[0].status}</p>}
        <button type="button" className={control} disabled={busy || !enabled || Boolean(notice) || sent.some(row => unresolved.includes(row.status))}
          onClick={() => void action('send')}>
          {busy ? 'Sending…' : alreadySent ? 'Resend via SMS' : needsApproval ? 'Approve and send via SMS' : 'Send ' + subject}
        </button>
      </>}
    </>}
    {(error || loadError) && <p role="alert" className="text-sm text-red-300">{error || loadError}</p>}
    {notice && <p role="status" className="text-sm text-sky-200">{notice}</p>}
  </div>;

  if (!chat || conversation) return content;
  return <details open={open} className="crm-panel my-3 px-3" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex min-h-12 cursor-pointer items-center gap-2 font-semibold text-white"><MessageSquare className="size-4 text-sky-300" /> Customer SMS</summary>
    {open && <div className="pb-4">{content}</div>}
  </details>;
}
