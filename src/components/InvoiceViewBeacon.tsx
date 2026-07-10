'use client';

import { useEffect, useRef } from 'react';

// Fires once when a real browser opens the invoice page, telling the server the
// customer has seen it. Runs client-side on purpose: link-preview crawlers
// (iMessage / WhatsApp / etc.) don't execute JS, so unfurling the link won't
// falsely mark it seen. The API skips the hit if an admin session cookie is present.
export default function InvoiceViewBeacon({ token }: { token: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // guard React strict-mode double-invoke in dev
    fired.current = true;
    fetch(`/api/invoice/${token}/view`, { method: 'POST', keepalive: true }).catch(() => {});
  }, [token]);
  return null;
}
