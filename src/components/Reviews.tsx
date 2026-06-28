'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { Star, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { REVIEWS, GOOGLE_REVIEWS_URL } from '@/lib/reviews';

const VISIBLE = 3;       // reviews shown at once
const ROTATE_MS = 30000; // rotate every 30s

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase();
}

function Stars({ n }: { n: number }) {
  return (
    <div className="flex gap-1" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn('size-4', i < n ? 'fill-amber-400 stroke-amber-400' : 'fill-slate-200 stroke-transparent')}
        />
      ))}
    </div>
  );
}

export default function Reviews() {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '-100px' });
  const [start, setStart] = useState(0);

  // Rotate the visible window of reviews on an interval
  useEffect(() => {
    const t = setInterval(() => setStart(s => (s + VISIBLE) % REVIEWS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  const visible = Array.from({ length: VISIBLE }, (_, i) => REVIEWS[(start + i) % REVIEWS.length]);
  const pages = Math.ceil(REVIEWS.length / VISIBLE);
  const activePage = Math.floor(start / VISIBLE) % pages;

  return (
    <section id="reviews" ref={ref} className="bg-slate-50 border-t border-slate-200 py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-6">
        {/* Heading */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="text-center mb-10"
        >
          <span className="text-sky-600 text-xs font-semibold uppercase tracking-[0.18em]">Reviews</span>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-slate-900 mt-3">What Canberra customers say</h2>

          {/* Google rating summary */}
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-3 bg-white border border-slate-200 shadow-sm rounded-md px-5 py-2.5 hover:border-sky-300 transition-colors cursor-pointer group"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-900 font-bold">5.0</span>
              <Stars n={5} />
            </span>
            <span className="text-slate-500 text-sm hidden sm:inline">· Google reviews</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-600 transition-colors" />
          </a>
        </motion.div>

        {/* Rotating grid — 1 / 2 / 3 columns */}
        <div className="relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={start}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
            >
              {visible.map((t, index) => (
                <div
                  key={`${start}-${index}`}
                  className="flex flex-col rounded-lg border border-slate-200 bg-white shadow-sm p-5"
                >
                  <Stars n={t.stars} />
                  <p className="text-slate-600 text-sm leading-relaxed my-4 flex-1">{t.quote}</p>
                  <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-sky-50 text-sky-700 border border-sky-200 text-xs font-bold">
                        {initial(t.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-slate-900 text-sm font-medium">{t.name}</span>
                    <span aria-hidden className="bg-slate-300 size-1 rounded-full" />
                    <span className="text-slate-500 text-sm">{t.date}</span>
                  </div>
                </div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Page indicators */}
        <div className="flex justify-center gap-2 mt-8">
          {Array.from({ length: pages }).map((_, i) => (
            <button
              key={i}
              onClick={() => setStart(i * VISIBLE)}
              aria-label={`Show reviews page ${i + 1}`}
              className={cn(
                'rounded-full transition-all duration-300 cursor-pointer',
                activePage === i ? 'w-6 h-2 bg-sky-500' : 'w-2 h-2 bg-slate-300 hover:bg-slate-400'
              )}
            />
          ))}
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sky-600 hover:text-sky-700 text-sm font-semibold transition-colors cursor-pointer"
          >
            Read more reviews on Google <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
