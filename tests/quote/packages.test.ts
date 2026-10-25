import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  packagePricesFromComplete, packagePercentsFromSettings, quoteForPackage, quoteDiscountBreakdown, packageIneligibleReason, resolvePackageFields,
  buildQuoteText, emptyQuoteDraft, PACKAGE_INCLUSIONS, PACKAGE_HARD_WATER_TERMS, WINDOW_INSIDE_KEY, WINDOW_OUTSIDE_KEY,
} from '../../src/lib/quote';

const WINDOWS = [WINDOW_OUTSIDE_KEY, WINDOW_INSIDE_KEY];

test('package prices derive from Complete (half up, Essential to $1, Premium to $50)', () => {
  const cases: [number, number, number][] = [
    [399, 299, 700], [400, 300, 700], [500, 375, 900], [600, 450, 1050], [800, 600, 1400],
  ];
  for (const [complete, essential, premium] of cases) {
    assert.deepEqual(packagePricesFromComplete(complete * 100),
      { essential: essential * 100, complete: complete * 100, premium: premium * 100 }, `Complete $${complete}`);
  }
});

test('$400 Complete with a $50 discount, customer picks Premium -> $700, -$50, $650', () => {
  const q = {
    services: WINDOWS, extras: [], itemAmounts: {}, amount: 350,
    otherLines: [{ id: 'd', description: 'Facebook discount', amount: -50 }],
    packagePrices: packagePricesFromComplete(40000), selectedPackage: null,
  };
  const view = quoteForPackage(q, 'premium');
  assert.equal(view.amount, 650);
  assert.deepEqual(quoteDiscountBreakdown(view), { beforeDiscount: 700, discount: -50, total: 650 });
  // Idempotent: resolving an already-resolved view gives the same thing.
  assert.equal(quoteForPackage(view, 'premium').amount, 650);
});

test('inclusions: 8 rows, ticks per spec', () => {
  assert.equal(PACKAGE_INCLUSIONS.length, 8);
  const count = (k: 'essential' | 'complete' | 'premium') => PACKAGE_INCLUSIONS.filter(r => r.in.includes(k)).length;
  assert.deepEqual([count('essential'), count('complete'), count('premium')], [2, 5, 8]);
});

test('three-package only for inside + outside windows, discounts allowed', () => {
  assert.equal(packageIneligibleReason({ services: WINDOWS, extras: [], otherLines: [{ id: 'd', description: 'x', amount: -100 }] }), null);
  assert.match(packageIneligibleReason({ services: [...WINDOWS, 'solar-panel-cleaning'], extras: [], otherLines: [] }) ?? '', /Solar Panel Cleaning/);
  assert.match(packageIneligibleReason({ services: WINDOWS, extras: ['gutter-cleaning'], otherLines: [] }) ?? '', /Single Quote/);
  assert.ok(packageIneligibleReason({ services: [WINDOW_OUTSIDE_KEY], extras: [], otherLines: [] }));
  assert.ok(packageIneligibleReason({ services: WINDOWS, extras: [], otherLines: [{ id: 'o', description: 'balcony', amount: 40 }] }));
});

test('server ignores Essential/Premium sent by the browser and adds the hard-water terms', () => {
  const q = { services: WINDOWS, extras: [], otherLines: [{ id: 'd', description: 'Meta ads discount', amount: -100 }], termsText: 'No GST has been charged.' };
  const r = resolvePackageFields({ quoteType: 'packages', packagePrices: { essential: 1, complete: 50000, premium: 2 } }, q);
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.deepEqual(r.packagePrices, { essential: 37500, complete: 50000, premium: 90000 });
  assert.equal(r.amount, 400);
  assert.ok(r.termsText.includes(PACKAGE_HARD_WATER_TERMS));
  assert.deepEqual(resolvePackageFields({ quoteType: 'single' }, q), { quoteType: 'single', packagePrices: null, amount: null, termsText: q.termsText });
});

test('custom Settings percents (e.g. 80% / 200%) and keeping stored prices', () => {
  const pct = packagePercentsFromSettings({ packageEssentialPercent: 80, packagePremiumPercent: 200 });
  assert.deepEqual(packagePricesFromComplete(40000, pct), { essential: 32000, complete: 40000, premium: 80000 });
  assert.deepEqual(packagePricesFromComplete(39900, pct), { essential: 31900, complete: 39900, premium: 80000 }); // 798 -> $800
  assert.deepEqual(packagePercentsFromSettings(null), { essential: 75, premium: 175 });

  const q = { services: WINDOWS, extras: [], otherLines: [], termsText: '' };
  const old = packagePricesFromComplete(40000); // saved under 75 / 175
  // Re-saving with the same Complete keeps the old prices even though Settings changed...
  const same = resolvePackageFields({ quoteType: 'packages', packagePrices: { complete: 40000 } }, q, pct, old);
  assert.ok(!('error' in same) && same.packagePrices === old);
  // ...but a new Complete price uses the current Settings.
  const changed = resolvePackageFields({ quoteType: 'packages', packagePrices: { complete: 50000 } }, q, pct, old);
  assert.ok(!('error' in changed) && changed.packagePrices?.premium === 100000);
});

test('single quotes: copied text unchanged by the package code', () => {
  const d = emptyQuoteDraft({ fromName: 'L', fromTradingAs: 'Glass and Blast', fromAbn: '', fromAddress: '', fromEmail: '', fromPhone: '' }, '2026-10-25');
  const text = buildQuoteText({ ...d, number: 'Q1', services: [WINDOW_OUTSIDE_KEY], itemAmounts: { [WINDOW_OUTSIDE_KEY]: 200 }, amount: 200 });
  assert.match(text, /Window Cleaning - Outside: \$200\.00/);
  assert.match(text, /Total quote: \$200\.00/);
  assert.doesNotMatch(text, /package/i);
});
