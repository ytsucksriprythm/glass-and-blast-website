'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';

// Customer says "I've paid". This only records the claim and pings the owner —
// it never touches the invoice/booking's real paid status, which stays a
// manual call once the money is actually seen in the account. Then sends the
// customer on to the thank-you page (invoice, photos, feedback).
export default function MarkPaidButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');

  const submit = async () => {
    setState('busy');
    try {
      const res = await fetch(`/api/invoice/${token}/mark-paid`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setState('done');
      if (data.thanksUrl) router.push(data.thanksUrl);
    } catch {
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <span className="no-print inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
        <CheckCircle2 className="w-4 h-4" /> Thanks — taking you through
      </span>
    );
  }

  return (
    <button
      onClick={submit}
      disabled={state === 'busy'}
      className="no-print inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold transition-colors cursor-pointer"
    >
      {state === 'busy' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
      I&apos;ve paid
    </button>
  );
}
