'use client';

import AdminRecordShell from '@/components/admin/AdminRecordShell';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Quote } from '@/lib/quote';
import { bookingToInvoicePrefill } from '@/lib/invoicePrefill';
import InvoiceEditor, { type InvoicePrefill } from '@/components/InvoiceEditor';

function NewInvoiceInner() {
  const router = useRouter();
  const search = useSearchParams();
  const fromBooking = search.get('fromBooking');
  const returnTo = search.get('returnTo');
  const bookingBack = fromBooking ? '/admin/bookings/' + encodeURIComponent(fromBooking) + (returnTo ? '?from=' + encodeURIComponent(returnTo) : '') : null;
  const [prefill, setPrefill] = useState<InvoicePrefill | undefined>(undefined);
  const [ready, setReady] = useState(!fromBooking);

  useEffect(() => {
    if (!fromBooking) return;
    (async () => {
      try {
        const [bRes, qRes] = await Promise.all([
          fetch(`/api/admin/bookings/${fromBooking}`),
          fetch(`/api/admin/quotes?bookingId=${fromBooking}`),
        ]);
        if (bRes.ok) {
          const quotes: Quote[] = qRes.ok ? await qRes.json() : [];
          setPrefill(bookingToInvoicePrefill(await bRes.json(), quotes));
        }
      } finally { setReady(true); }
    })();
  }, [fromBooking]);

  return (
    <AdminRecordShell active="invoices">
      <header
        className="crm-topbar sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push(bookingBack ?? '/admin/invoices')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer">
          <ArrowLeft className="w-5 h-5" /> {bookingBack ? "Booking" : "Invoices"}
        </button>
        <h1 className="font-bold text-white">New invoice</h1>
      </header>
      <main className="px-4 py-6 pb-28">
        {ready
          ? <InvoiceEditor initial={null} prefill={prefill} returnHref={bookingBack ?? undefined} />
          : <div className="max-w-6xl mx-auto h-64 bg-white/5 rounded-xl animate-pulse" />}
      </main>
    </AdminRecordShell>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<div className="min-h-[100svh] bg-navy-900" />}>
      <NewInvoiceInner />
    </Suspense>
  );
}
