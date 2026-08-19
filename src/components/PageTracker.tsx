'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

function newViewId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sendBeaconOrFetch(url: string, body: string) {
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch {
    /* tracking must never break the page */
  }
}

// Fires one view ping per route change, plus a second "how far down the page
// did they get" ping when they leave it — covers an SPA route change, a tab
// close/refresh (pagehide), and backgrounding the tab (visibilitychange),
// since on mobile especially people close out without ever firing pagehide.
// Both pings carry only a per-view random id + a percentage, no PII.
export default function PageTracker() {
  const pathname = usePathname();
  const viewIdRef = useRef<string | null>(null);
  const maxScrollRef = useRef(0);

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;

    const viewId = newViewId();
    viewIdRef.current = viewId;
    maxScrollRef.current = 0;

    sendBeaconOrFetch('/api/track', JSON.stringify({ path: pathname, referrer: document.referrer || '', viewId }));

    const measureScroll = () => {
      const doc = document.documentElement;
      const scrollHeight = Math.max(doc.scrollHeight, document.body.scrollHeight, doc.clientHeight, 1);
      const scrolled = window.scrollY + window.innerHeight;
      const pct = Math.min(100, Math.round((scrolled / scrollHeight) * 100));
      if (pct > maxScrollRef.current) maxScrollRef.current = pct;
    };
    measureScroll(); // captures "above the fold" even if they never scroll at all

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { measureScroll(); ticking = false; });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    const flush = () => {
      const vid = viewIdRef.current;
      if (!vid) return;
      sendBeaconOrFetch('/api/track/scroll', JSON.stringify({ viewId: vid, maxScrollPercent: maxScrollRef.current }));
    };
    const onVisibility = () => { if (document.hidden) flush(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);

    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush(); // leaving via an in-app route change — this is the only signal we get
      viewIdRef.current = null;
    };
  }, [pathname]);

  return null;
}
