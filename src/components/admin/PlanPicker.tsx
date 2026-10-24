'use client';

// Timeframe picker for a recurring customer: the three website plan tiers
// (with their discounts) or Custom — "every [N] weeks / months / years".
import type { RecurringFrequency, IntervalUnit } from '@/lib/db';
import { PLAN_PRESETS, PLAN_DISCOUNT_MIN, INTERVAL_UNITS, presetDiscount } from '@/lib/recurring';

export type PlanValue = {
  frequency: RecurringFrequency;
  customInterval: string;
  customIntervalUnit: IntervalUnit;
  discount: string;
};

export const DEFAULT_PLAN: PlanValue = { frequency: 'quarterly', customInterval: '', customIntervalUnit: 'weeks', discount: '75' };

// The API body for a PlanValue; null when Custom is missing its number.
export function planPayload(v: PlanValue) {
  const n = Number(v.customInterval);
  if (v.frequency === 'custom' && (!Number.isInteger(n) || n < 1)) return null;
  const d = Number(v.discount.replace(/[^0-9.]/g, ''));
  return {
    frequency: v.frequency,
    customInterval: v.frequency === 'custom' ? n : null,
    customIntervalUnit: v.customIntervalUnit,
    discount: v.discount.trim() && d > 0 ? d : null,
  };
}

const chip = (on: boolean) =>
  `rounded-lg border text-sm font-medium transition-colors cursor-pointer touch-manipulation ${on ? 'border-amber-400 bg-amber-400/15 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'}`;

export default function PlanPicker({ value, onChange }: { value: PlanValue; onChange: (v: PlanValue) => void }) {
  const pick = (frequency: RecurringFrequency) => {
    // A tier brings its website discount with it; Custom keeps whatever's typed.
    const d = presetDiscount(frequency);
    onChange({ ...value, frequency, discount: d != null ? String(d) : value.frequency === 'custom' ? value.discount : '' });
  };
  // Older profiles can be weekly/fortnightly; show them as selected-but-custom-looking.
  const isPreset = PLAN_PRESETS.some(p => p.frequency === value.frequency);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {PLAN_PRESETS.map(p => (
          <button key={p.frequency} type="button" onClick={() => pick(p.frequency)} className={`${chip(value.frequency === p.frequency)} px-3 py-2.5 text-left`}>
            <span className="block">{p.label}</span>
            <span className="block text-xs text-emerald-300 font-semibold">${p.discount} off each clean</span>
          </button>
        ))}
        <button type="button" onClick={() => pick('custom')} className={`${chip(value.frequency === 'custom' || !isPreset)} px-3 py-2.5 text-left`}>
          <span className="block">Custom</span>
          <span className="block text-xs text-slate-400">Pick your own timeframe</span>
        </button>
      </div>

      {value.frequency === 'custom' && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            {INTERVAL_UNITS.map(u => (
              <button key={u} type="button" onClick={() => onChange({ ...value, customIntervalUnit: u })} className={`${chip(value.customIntervalUnit === u)} px-2 py-2 capitalize`}>
                {u}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-slate-300 text-sm">Every</span>
            <input
              className="form-input !w-20 text-center"
              inputMode="numeric"
              placeholder="#"
              value={value.customInterval}
              onChange={e => onChange({ ...value, customInterval: e.target.value.replace(/[^0-9]/g, '') })}
            />
            <span className="text-slate-300 text-sm">{value.customInterval === '1' ? value.customIntervalUnit.slice(0, -1) : value.customIntervalUnit}</span>
          </div>
        </div>
      )}

      <div>
        <label className="block text-slate-400 text-xs font-medium mb-1.5">Discount per clean ($)</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">$</span>
          <input className="form-input pl-8" inputMode="decimal" placeholder="0" value={value.discount} onChange={e => onChange({ ...value, discount: e.target.value })} />
        </div>
        <p className="text-slate-500 text-xs mt-1">Comes off jobs over ${PLAN_DISCOUNT_MIN}, same as the website plans.</p>
      </div>
    </div>
  );
}
