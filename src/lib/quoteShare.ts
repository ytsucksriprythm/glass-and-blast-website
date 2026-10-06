// Message that goes with a quote link when it's shared (share sheet) or
// copied (clipboard fallback) — a friendly note to the customer instead of
// just the quote number.

function firstName(billToName: string): string {
  return (billToName ?? '').trim().split(/\s+/)[0] ?? '';
}

export function quoteShareMessage(q: { billToName: string; fromTradingAs: string }): string {
  const name = firstName(q.billToName);
  const business = q.fromTradingAs?.trim() || 'Glass & Blast';
  return `Hey ${name || 'there'}, here's the link to your quote from ${business}:`;
}

// Clipboard version: message and link together, ready to paste into a text.
export function quoteShareClipboardText(q: { billToName: string; fromTradingAs: string }, url: string): string {
  return `${quoteShareMessage(q)}\n${url}`;
}
