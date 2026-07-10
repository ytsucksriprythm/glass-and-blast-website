'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Invoice } from '@/lib/invoice';
import InvoiceEditor from '@/components/InvoiceEditor';

export default function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/invoices/${id}`);
        if (res.status === 401) { router.push('/admin'); return; }
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
        {state === 'ready' && invoice && <InvoiceEditor initial={invoice} />}
      </main>
    </div>
  );
}
