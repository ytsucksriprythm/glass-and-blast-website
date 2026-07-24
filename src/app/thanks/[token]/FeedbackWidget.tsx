'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

// Owner's Google review link — 4-5 star ratings go straight here.
const REVIEW_URL = 'https://g.page/r/CTZqwIjUWFvcEBM/review';

export default function FeedbackWidget({ token, alreadyRated }: { token: string; alreadyRated: number | null }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'pick' | 'text' | 'done'>(alreadyRated ? 'done' : 'pick');
  const [busy, setBusy] = useState(false);

  const send = async (rating: number, body: string) => {
    try {
      await fetch(`/api/thanks/${token}/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: rating, text: body }),
      });
    } catch { /* best-effort — don't block the customer */ }
  };

  // Choosing a rating: 4-5 → record then redirect to Google; 1-3 → ask for text.
  const choose = async (rating: number) => {
    setStars(rating);
    if (rating >= 4) {
      setBusy(true);
      await send(rating, '');
      window.location.href = REVIEW_URL;
      return;
    }
    setPhase('text');
  };

  const submitText = async () => {
    setBusy(true);
    await send(stars, text);
    setPhase('done');
    setBusy(false);
  };

  if (phase === 'done') {
    return (
      <div className="text-center">
        <h2 className="font-display text-xl font-bold">Thanks for your feedback</h2>
        <p className="text-slate-600 mt-1">It helps us keep improving.</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h2 className="font-display text-xl font-bold">How did we do?</h2>
      <p className="text-slate-600 mt-1 text-sm">Tap a star to rate your experience.</p>

      <div className="flex justify-center gap-1.5 mt-4" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => {
          const on = (hover || stars) >= n;
          return (
            <button
              key={n}
              onClick={() => choose(n)}
              onMouseEnter={() => setHover(n)}
              disabled={busy}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className="p-1 cursor-pointer disabled:opacity-50"
            >
              <Star className={`w-9 h-9 transition-colors ${on ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            </button>
          );
        })}
      </div>

      {phase === 'text' && (
        <div className="mt-5 text-left">
          <label className="block text-slate-600 text-sm font-medium mb-1.5">Sorry we fell short. What could we have done better?</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 outline-none p-3 text-slate-900"
            placeholder="Your feedback goes straight to the owner."
          />
          <button
            onClick={submitText}
            disabled={busy}
            className="mt-3 w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold transition-colors"
          >
            Send feedback
          </button>
        </div>
      )}
    </div>
  );
}
