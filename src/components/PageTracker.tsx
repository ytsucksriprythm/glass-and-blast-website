'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Fires one tracking ping per route change. Skips the admin area.
export default function PageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;

    const body = JSON.stringify({ path: pathname, referrer: document.referrer || '' });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        });
      }
    } catch {
      /* tracking must never break the page */
    }
  }, [pathname]);

  return null;
}
