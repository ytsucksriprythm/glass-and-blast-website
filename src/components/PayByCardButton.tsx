'use client';

import { CreditCard } from 'lucide-react';

// Logs the click (best-effort, fire-and-forget) before letting the link open
// Square's checkout in a new tab — target="_blank" means this page never
// unloads, so there's no race with the fetch.
export default function PayByCardButton({ token, href, label }: { token: string; href: string; label: string }) {
  const logClick = () => {
    fetch(`/api/invoice/${token}/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'invoice.pay_by_card_clicked' }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={logClick}
      className="no-print mb-4 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors"
    >
      <CreditCard className="w-4 h-4" /> {label}
    </a>
  );
}
