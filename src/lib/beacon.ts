'use client';

// Fire-and-forget POST to a tracking endpoint — sendBeacon when available
// (survives the page unloading), fetch+keepalive otherwise. Shared by
// PageTracker (page views + scroll depth) and the booking form funnel
// tracker so both degrade the same way. Never throws: tracking must never
// be able to break the page it's reporting on.
export function sendBeaconOrFetch(url: string, body: string) {
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
