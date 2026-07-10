'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import type { Invoice } from '@/lib/invoice';
import InvoiceEditor from '@/components/InvoiceEditor';

export default function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'denied'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/invoices/${id}`);
        if (res.status === 401) { router.push('/admin'); return; }
        // A guest reaching for someone else's invoice.
        if (res.status === 403) { setState('denied'); return; }
        if (res.status === 404) { setState('notfound'); return; }
        if (res.ok) { setInvoice(await res.json()); setState('ready'); }
      } catch { setState('notfound'); }
    })();
  }, [id, router]);

  return (
    <div className="min-h-[100svh] bg-navy-900">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push('/admin/invoices')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer">
          <ArrowLeft className="w-5 h-5" /> Invoices
        </button>
        <span className="text-white font-semibold text-sm">{invoice ? invoice.number : 'Invoice'}</span>
      </header>
      <main className="px-4 py-6 pb-28">
        {state === 'loading' && <div className="max-w-6xl mx-auto h-64 bg-white/5 rounded-xl animate-pulse" />}
        {state === 'notfound' && <div className="text-center py-16 text-slate-500 text-sm">Invoice not found.</div>}
        {state === 'denied' && (
          <div className="max-w-sm mx-auto text-center py-16">
            <span className="w-14 h-14 rounded-2xl bg-red-400/10 border border-red-400/20 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7 text-red-400" />
            </span>
            <h2 className="font-display text-xl font-bold text-white mt-4">Access denied</h2>
            <p className="text-slate-500 text-sm mt-2">This invoice belongs to someone else. You can only open invoices you created.</p>
            <button onClick={() => router.push('/admin/invoices')} className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-sm font-semibold cursor-pointer">
              Back to my invoices
            </button>
          </div>
        )}
        {state === 'ready' && invoice && <InvoiceEditor initial={invoice} />}
      </main>
    </div>
  );
}
