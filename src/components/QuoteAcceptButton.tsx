'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { PackageKey } from '@/lib/quote';

// Accepts one package of a three-package quote. Only the package key is sent;
// the server works out the price. Afterwards the page reloads without the
// ?package= param, and from then on it only shows the accepted quote.
export default function QuoteAcceptButton({ token, pkg, label }: { token: string; pkg: PackageKey; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    if (!window.confirm(`Accept the ${label} package? Once accepted it can't be changed online.`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch(`/api/quote/${token}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ package: pkg }),
      });
      if (res.ok || res.status === 409) { window.location.href = `/quote/${token}`; return; }
      setError((await res.json().catch(() => null))?.error || 'Something went wrong, please try again or give us a call.');
    } catch {
      setError('Could not reach us, please check your connection and try again.');
    }
    setBusy(false);
  };

  return (
    <div>
      <button
        onClick={accept} disabled={busy}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 px-6 py-3 text-sm font-bold text-white cursor-pointer"
      >
        {busy ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
        Accept {label} quote
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
