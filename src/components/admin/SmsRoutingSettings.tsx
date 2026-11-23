'use client';

import { useState } from 'react';

type Stats = { assigned: number; submitted: number; segments: number; failed: number; pending: number; estimatedCostAud: number | null; unpriced: number };
type Report = {
  legacyTwilio: number; withoutHistory: number; review: number; ready: boolean; twilioConfigured: boolean;
  sendingEnabled: boolean; dataflowsConfigured: boolean; twilioNumber: string | null; dataflowsNumber: string | null;
  twilio: Stats; dataflows: Stats;
  reviewRoutes: { phone: string; provider: string; senderNumber: string }[];
};

export default function SmsRoutingSettings() {
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  async function request(backfill = false) {
    if (backfill && !window.confirm('Lock historical SMS contacts to their Twilio sender? This does not send messages.')) return;
    setBusy(true);
    setNotice('');
    try {
      if (backfill) {
        const result = await fetch('/api/admin/sms/routing', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'backfill-twilio' }),
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error ?? 'Backfill failed.');
        setNotice(`Backfilled ${data.backfilled} Twilio assignments.`);
      }
      const result = await fetch('/api/admin/sms/routing', { cache: 'no-store' });
      if (!result.ok) throw new Error('Could not load the routing report.');
      setReport(await result.json());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not complete the request.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-3 text-sm text-slate-300">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void request()}
        className="rounded-lg border border-white/15 px-3 py-2 font-semibold text-sky-300 disabled:opacity-50">Run routing dry run</button>
      {report && <button type="button" disabled={busy || !report.twilioConfigured} onClick={() => void request(true)}
        className="rounded-lg border border-white/15 px-3 py-2 font-semibold text-sky-300 disabled:opacity-50">Backfill Twilio routing</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {report && <>
      <p>{report.legacyTwilio} numbers with Twilio history · {report.withoutHistory} CRM numbers without SMS history · {report.review} assignments flagged for review</p>
      {report.reviewRoutes.length > 0 && <details>
        <summary className="cursor-pointer text-sky-300">Review flagged routes ({report.reviewRoutes.length} shown)</summary>
        <ul className="mt-2 space-y-1">
          {report.reviewRoutes.map(route => <li key={route.phone}>{route.phone} · {route.provider} · {route.senderNumber}</li>)}
        </ul>
      </details>}
      {!report.ready && <p>DataFlows cutover is awaiting validation.</p>}
      {!report.sendingEnabled && <p>SMS sending is disabled in this environment.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {([
          ['Twilio', report.twilioNumber, report.twilioConfigured, report.twilio],
          ['DataFlows', report.dataflowsNumber, report.dataflowsConfigured, report.dataflows],
        ] as const).map(([name, number, configured, stats]) => <article key={name} className="rounded-lg border border-white/10 p-3">
          <h3 className="font-semibold text-white">{name} · {configured ? 'Configured' : 'Setup required'}</h3>
          <p>{number || 'No sender configured'}</p>
          <p>{stats.assigned} assigned · {stats.submitted} submitted · {stats.segments} segments</p>
          <p>{stats.pending} pending · {stats.failed} failed or unresolved</p>
          <p>Estimated cost {stats.estimatedCostAud === null ? 'unpriced' : `A$${stats.estimatedCostAud.toFixed(2)}`}
            {stats.unpriced > 0 && ` · ${stats.unpriced} unpriced`}</p>
        </article>)}
      </div>
    </>}
  </div>;
}
