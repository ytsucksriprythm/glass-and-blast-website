'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function CancelledInvoiceNotice({ number, message, replacementHref, children }: {
  number: string;
  message?: string;
  replacementHref: string | null;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  if (showOriginal) return children;

  return (
    <dialog ref={dialog} aria-labelledby="cancelled-invoice-title"
      onCancel={event => event.preventDefault()}
      className="no-print m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/60">
      <p className="text-sm font-medium text-slate-500">Invoice {number}</p>
      <h1 id="cancelled-invoice-title" className="mt-1 text-xl font-bold">This invoice has been cancelled</h1>
      <p className="mt-2 text-sm text-slate-700">No payment is required for this invoice.</p>
      {message && <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        {replacementHref && <a href={replacementHref} className="rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white">View updated invoice</a>}
        <button type="button" onClick={() => setShowOriginal(true)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">
          View cancelled invoice
        </button>
      </div>
    </dialog>
  );
}
