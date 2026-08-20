'use client';

import { useState } from 'react';
import { AlertTriangle, X, Check } from 'lucide-react';
import type { Booking } from '@/lib/db';

// Small icon button used in list rows/cards and the booking detail header.
// Neutral when clean; solid red once the job is flagged, so it reads as a
// warning at a glance and doubles as the "view the note" tap target.
export function FlagButton({ booking, onClick, size = 'md' }: { booking: Booking; onClick: () => void; size?: 'sm' | 'md' }) {
  const flagged = !!booking.flaggedAt;
  const pad = size === 'sm' ? 'p-1.5' : 'p-2.5';
  const icon = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <button
      onClick={onClick}
      title={flagged ? 'Job flagged, tap to view' : 'Flag a problem with this job'}
      className={`${pad} rounded-lg border cursor-pointer transition-all ${
        flagged
          ? 'bg-red-500/20 border-red-400/50 text-red-300'
          : 'glass border-white/10 text-slate-500 hover:text-red-300 hover:border-red-400/30'
      }`}
    >
      <AlertTriangle className={icon} />
    </button>
  );
}

// Inline tag next to a customer's name — same slot as the "Sent to" / "Customer
// says paid" badges, so a flagged job stands out in the list without opening anything.
export function FlagBadge({ booking }: { booking: Booking }) {
  if (!booking.flaggedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-300 border border-red-400/30" title={booking.flagNote ?? 'Flagged'}>
      <AlertTriangle className="w-2.5 h-2.5" /> Flagged
    </span>
  );
}

// className to merge onto a card/row's own border classes to highlight it red when flagged.
export const flagHighlightClass = (booking: Booking) =>
  booking.flaggedAt ? 'border-red-400/40 bg-red-500/[0.05]' : '';

// Add / view / edit / clear — one modal covers the whole lifecycle. Unflagged
// jobs get a "describe what happened" form; flagged jobs show the note with
// options to update it or clear the flag entirely.
export function FlagModal({ booking, onClose, onSave, onClear }: {
  booking: Booking;
  onClose: () => void;
  onSave: (note: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}) {
  const flagged = !!booking.flaggedAt;
  const [note, setNote] = useState(booking.flagNote ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await onSave(note.trim()); } finally { setBusy(false); }
  };
  const clear = async () => {
    setBusy(true);
    try { await onClear(); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div className="bg-navy-800 border border-red-400/20 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" /> {flagged ? 'Flagged job' : 'Flag a problem'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          {flagged && booking.flaggedAt && (
            <div className="text-slate-500 text-xs">
              Flagged {new Date(booking.flaggedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
          <textarea
            autoFocus
            className="form-input resize-none w-full"
            rows={4}
            placeholder="What went wrong?"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            {flagged && (
              <button onClick={clear} disabled={busy} className="px-4 py-2.5 rounded-lg border border-white/10 text-red-300 hover:border-red-400/40 text-sm font-semibold cursor-pointer disabled:opacity-50">
                Clear flag
              </button>
            )}
            <button onClick={submit} disabled={busy || !note.trim()} className="flex-1 py-2.5 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-semibold rounded-lg text-sm cursor-pointer flex items-center justify-center gap-2">
              {busy ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              {flagged ? 'Save note' : 'Flag job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
