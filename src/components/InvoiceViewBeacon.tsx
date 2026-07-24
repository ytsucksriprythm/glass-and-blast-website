'use client';

import { useEffect, useRef } from 'react';

// Fires once when a real browser opens the invoice page, telling the server the
// customer has seen it. Runs client-side on purpose: link-preview crawlers
// (iMessage / WhatsApp / etc.) don't execute JS, so unfurling the link won't
// falsely mark it seen. The API skips the hit if an admin session cookie is present.
//
// Also opens a detailed view-session (IP/device/location, captured server-side)
// and reports how long the tab stayed open when it's hidden or closed — that's
// what shows up in an invoice's "View log".
export default function InvoiceViewBeacon({ token }: { token: string }) {
  const fired = useRef(false);
  const sessionId = useRef<string | null>(null);

  useEffect(() => {
    if (fired.current) return; // guard React strict-mode double-invoke in dev
    fired.current = true;
    fetch(`/api/invoice/${token}/view`, { method: 'POST', keepalive: true })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.sessionId) sessionId.current = data.sessionId; })
      .catch(() => {});

    const endSession = () => {
      if (!sessionId.current) return;
      const blob = new Blob([JSON.stringify({ sessionId: sessionId.current })], { type: 'application/json' });
      navigator.sendBeacon(`/api/invoice/${token}/view/end`, blob);
      sessionId.current = null; // avoid double-firing from both listeners
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') endSession(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', endSession);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', endSession);
    };
  }, [token]);

  return null;
}
