import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { AssetClass, Portfolio } from '../api/types';
import { formatINR, formatPct } from '../lib/format';
import { humanize } from '../lib/options';

/** Fixed colour per asset class, so a class looks the same on every customer. The legend always adds text + %. */
const COLORS: Record<AssetClass, string> = {
  EQUITY: '#4f46e5',
  ETF: '#0ea5e9',
  MUTUAL_FUND: '#10b981',
  BOND: '#f59e0b',
  REIT: '#ec4899',
  GSEC: '#64748b',
};

export function AllocationChart({ slices }: { slices: Portfolio['allocation'] }) {
  const data = slices.map((s) => ({ ...s, name: humanize(s.assetClass), value: Number(s.marketValue) }));
  const summary = `Asset allocation: ${data.map((d) => `${d.name} ${formatPct(d.weightPct)}`).join(', ')}.`;

  return (
    <figure>
      {/* The chart is a picture for screen readers: they get the summary here and the data table below. */}
      <div role="img" aria-label={summary} className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" paddingAngle={2} stroke="#fff" isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.assetClass} fill={COLORS[d.assetClass]} />
              ))}
            </Pie>
            <Tooltip formatter={(_value, name, item) => [`${formatINR(item.payload.marketValue)} (${formatPct(item.payload.weightPct)})`, name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul aria-hidden="true" className="mt-3 space-y-1.5 text-sm">
        {data.map((d) => (
          <li key={d.assetClass} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-3 rounded-sm" style={{ backgroundColor: COLORS[d.assetClass] }} />
              {d.name}
            </span>
            <span className="tabular-nums text-slate-700">
              {formatPct(d.weightPct)} · {formatINR(d.marketValue)}
            </span>
          </li>
        ))}
      </ul>

      {/* The visually-hidden wrapper is a <div>: a <table> itself would ignore the 1px clip and widen the page. */}
      <div className="sr-only">
        <table>
          <caption>Allocation by asset class</caption>
          <thead>
            <tr>
              <th scope="col">Asset class</th>
              <th scope="col">Market value</th>
              <th scope="col">Share of portfolio</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.assetClass}>
                <th scope="row">{d.name}</th>
                <td>{formatINR(d.marketValue)}</td>
                <td>{formatPct(d.weightPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
