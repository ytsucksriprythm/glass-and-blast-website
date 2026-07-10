'use client';

import { Printer } from 'lucide-react';

// Print / "save as PDF" via the browser. Hidden when printing (see globals.css
// .no-print). The customer's browser print dialog offers "Save as PDF".
export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 active:bg-slate-700 transition-colors cursor-pointer"
    >
      <Printer className="w-4 h-4" /> Print / Save PDF
    </button>
  );
}
