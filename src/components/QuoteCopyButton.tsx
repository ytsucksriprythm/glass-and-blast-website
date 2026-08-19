'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import toast from 'react-hot-toast';

// Copies a pre-built plain-text quote (see buildQuoteText in lib/quote.ts) to
// the clipboard. Same shape as PrintButton — a dumb button, all the
// formatting happens server-side before this renders.
export default function QuoteCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Quote text copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select the text manually');
    }
  };
  return (
    <button
      onClick={copy}
      className="no-print inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy quote text'}
    </button>
  );
}
