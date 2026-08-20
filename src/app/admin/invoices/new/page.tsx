'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import type { Booking } from '@/lib/db';
import type { Quote } from '@/lib/quote';
import { paymentDueTermsDays } from '@/lib/invoice';
import InvoiceEditor, { type InvoicePrefill } from '@/components/InvoiceEditor';

const SERVICE_LABELS: Record<string, string> = {
  'window-washing': 'Window Cleaning',
  'pressure-washing': 'Pressure Washing',
  'flyscreen-repair': 'Flyscreen Repair',
  'solar-panel-cleaning': 'Solar Panel Cleaning',
  'both': 'Window & Pressure Washing',
  'other': 'Cleaning Service',
};
const serviceText = (s: string) =>
  (s ?? '').split(',').filter(Boolean).map(x => SERVICE_LABELS[x] ?? x).join(' + ') || 'Cleaning Service';

// dueDays comes from the booking's most recent Quote (if any) — carries the
// payment terms the customer already agreed to on the quote over to the
// invoice, instead of falling back to the generic default.
function bookingToPrefill(b: Booking, quotes: Quote[]): InvoicePrefill {
  const address = [b.address, b.suburb].filter(Boolean).join(', ');
  const latestQuote = quotes[0]; // getQuotesForBooking returns newest-first (by seq)
  return {
    billToName: b.name,
    billToLines: address,
    itemDescription: serviceText(b.service),
    itemServiceAddress: address,
    amount: typeof b.quoteAmount === 'number' ? b.quoteAmount : null,
    serviceDate: /^\d{4}-\d{2}-\d{2}$/.test(b.preferredDate) ? b.preferredDate : '',
    bookingId: b.id,
    dueDays: latestQuote ? paymentDueTermsDays(latestQuote.paymentTerms) : undefined,
  };
}

function NewInvoiceInner() {
  const router = useRouter();
  const search = useSearchParams();
  const fromBooking = search.get('fromBooking');
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
          setPrefill(bookingToPrefill(await bRes.json(), quotes));
        }
      } finally { setReady(true); }
    })();
  }, [fromBooking]);

  return (
    <div className="min-h-[100svh] bg-navy-900">
      <header
        className="sticky top-0 z-30 bg-navy-900/90 backdrop-blur border-b border-white/10 px-4 flex items-center justify-between"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.85rem)', paddingBottom: '0.85rem' }}
      >
        <button onClick={() => router.push('/admin/invoices')} className="inline-flex items-center gap-2 text-slate-300 hover:text-white text-sm cursor-pointer">
          <ArrowLeft className="w-5 h-5" /> Invoices
        </button>
        <span className="text-white font-semibold text-sm">New invoice</span>
      </header>
      <main className="px-4 py-6 pb-28">
        {ready
          ? <InvoiceEditor initial={null} prefill={prefill} />
          : <div className="max-w-6xl mx-auto h-64 bg-white/5 rounded-xl animate-pulse" />}
      </main>
    </div>
  );
}

export default function NewInvoicePage() {
  return (
    <Suspense fallback={<div className="min-h-[100svh] bg-navy-900" />}>
      <NewInvoiceInner />
    </Suspense>
  );
}
