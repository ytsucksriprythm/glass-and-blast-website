import { NextRequest, NextResponse } from 'next/server';
import { getQuoteById, updateQuote, deleteQuote, logActivity, getSettings } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth';
import { type Quote, resolvePackageFields, packagePercentsFromSettings } from '@/lib/quote';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const quote = await getQuoteById(id);
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(quote);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  const { id } = await params;

  const existing = await getQuoteById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const b = await req.json();
  // Whitelist editable fields — identity/number/seq/token/bookingId are never client-writable.
  const updates: Partial<Quote> = {};
  const copy = <K extends keyof Quote>(k: K) => { if (k in b) (updates as any)[k] = b[k]; };
  (['status', 'services', 'extras', 'itemAmounts', 'otherLines', 'amount', 'scope', 'assumptions', 'paymentTerms',
    'propertyType', 'billToName', 'billToAddress',
    'fromName', 'fromTradingAs', 'fromAbn', 'fromAddress', 'fromEmail', 'fromPhone', 'showFromAddress',
    'quoteDate', 'validUntil', 'notes', 'termsText'] as (keyof Quote)[]).forEach(copy);
  if ('amount' in updates) updates.amount = Number(updates.amount) || 0;
  if ('itemAmounts' in updates && updates.itemAmounts && typeof updates.itemAmounts === 'object') {
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(updates.itemAmounts)) { const n = Number(v); if (!isNaN(n)) clean[k] = n; }
    updates.itemAmounts = clean;
  }
  if ('otherLines' in updates && Array.isArray(updates.otherLines)) {
    updates.otherLines = (updates.otherLines as unknown[])
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map((l, i) => ({
        id: typeof l.id === 'string' && l.id ? l.id : `ol-${i}`,
        description: typeof l.description === 'string' ? l.description : '',
        amount: Number(l.amount) || 0,
      }));
  }

  // Three-package. Once the customer has accepted, the price is locked.
  // Before that, prices are re-derived from the Complete price on every save.
  const PRICING_KEYS = ['services', 'extras', 'itemAmounts', 'otherLines', 'amount', 'quoteType', 'packagePrices'];
  if (existing.acceptedAt) {
    if (PRICING_KEYS.some(k => k in b)) {
      return NextResponse.json({ error: 'The customer has already accepted this quote, so its price is locked' }, { status: 409 });
    }
  } else {
    const merged = { ...existing, ...updates };
    const pkg = resolvePackageFields(
      { quoteType: 'quoteType' in b ? b.quoteType : existing.quoteType, packagePrices: 'packagePrices' in b ? b.packagePrices : existing.packagePrices },
      merged,
      packagePercentsFromSettings(await getSettings()),
      existing.quoteType === 'packages' ? existing.packagePrices ?? null : null,
    );
    if ('error' in pkg) return NextResponse.json({ error: pkg.error }, { status: 400 });
    updates.quoteType = pkg.quoteType;
    updates.packagePrices = pkg.packagePrices;
    if (pkg.termsText !== existing.termsText) updates.termsText = pkg.termsText;
    if (pkg.amount != null) updates.amount = pkg.amount;
  }

  const quote = await updateQuote(id, updates);
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (updates.status && updates.status !== existing.status) {
    await logActivity('quote.status_changed', `${quote.number} ${existing.status} -> ${updates.status}`, { quoteId: quote.id, from: existing.status, to: updates.status }, 'admin');
  }
  return NextResponse.json(quote);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await isAdminAuthenticated()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const existing = await getQuoteById(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ok = await deleteQuote(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await logActivity('quote.deleted', `Quote ${existing.number} deleted`, { quoteId: id, bookingId: existing.bookingId }, 'admin');
  return NextResponse.json({ success: true });
}
