'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

// Thank-you popup shown once, straight after the customer accepts (the accept
// button sends them to ?accepted=1). Closing it drops the param so a refresh
// or a later visit just shows the accepted quote underneath.
export default function QuoteAcceptedPopup({ firstName, what, total, phone }: {
  firstName: string;
  what: string;   // "the Premium Detail package" or "your quote"
  total: string;  // already formatted, e.g. "$650.00"
  phone: string;
}) {
  const [open, setOpen] = useState(true);

  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('accepted');
    window.history.replaceState(null, '', url.pathname + url.search);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={close}>
      <div
        role="dialog" aria-modal="true" aria-labelledby="quote-accepted-title"
        className="relative w-full max-w-sm rounded-2xl bg-white p-6 sm:p-8 text-center shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={close} aria-label="Close" className="absolute right-3 top-3 p-2 text-slate-400 hover:text-slate-700 cursor-pointer">
          <X className="h-5 w-5" />
        </button>
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h2 id="quote-accepted-title" className="mt-4 font-display text-2xl font-extrabold text-slate-900">
          Thanks{firstName ? `, ${firstName}` : ''}!
        </h2>
        <p className="mt-2 text-slate-600">
          You&apos;ve accepted {what} ({total}). We&apos;ll be in touch soon to book in a time that suits you.
        </p>
        {phone && <p className="mt-3 text-sm text-slate-500">Need us sooner? Call {phone}.</p>}
        <button onClick={close} className="mt-6 w-full rounded-xl bg-sky-600 hover:bg-sky-700 px-4 py-3 text-sm font-bold text-white cursor-pointer">
          Close
        </button>
      </div>
    </div>
  );
}
