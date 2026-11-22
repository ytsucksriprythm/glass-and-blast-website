'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/invoice';

export type RevenuePoint = { period: string; label: string; amount: number };

const axisMoney = new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 1,
});

export default function RevenueLineChart({ points }: { points: RevenuePoint[] }) {
  return (
    <>
      <div className="h-60 min-w-0 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 12, right: 14, bottom: 4, left: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="#334155" strokeDasharray="3 4" />
            <XAxis dataKey="label" minTickGap={24} tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} stroke="#64748b" />
            <YAxis width={54} tickFormatter={value => axisMoney.format(value)} tick={{ fill: '#cbd5e1', fontSize: 11 }} tickLine={false} stroke="#64748b" />
            <Tooltip
              formatter={(value: number) => [money(value), 'Revenue']}
              contentStyle={{ background: '#111827', borderColor: '#475569', borderRadius: 10 }}
              labelStyle={{ color: '#e2e8f0' }}
            />
            <Line type="linear" dataKey="amount" stroke="#34d399" strokeWidth={2.5} dot={points.length === 1} activeDot={{ r: 5 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center text-sky-300">View chart values</summary>
        <dl className="divide-y divide-white/10">
          {points.map(({ period, label, amount }) => (
            <div key={period} className="flex justify-between gap-4 py-2">
              <dt className="text-slate-300">{label}</dt>
              <dd className="tabular-nums text-white">{money(amount)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
