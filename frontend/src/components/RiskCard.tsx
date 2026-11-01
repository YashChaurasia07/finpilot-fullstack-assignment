import type { RiskProfile } from '../api/types';
import { formatDate } from '../lib/format';
import { humanize } from '../lib/options';
import { riskTone } from '../lib/tones';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';

export function RiskCard({ risk }: { risk: RiskProfile | null }) {
  if (!risk) {
    return (
      <section className="card p-4" aria-labelledby="risk-heading">
        <h2 id="risk-heading" className="font-semibold">
          Risk profile
        </h2>
        <p className="mt-3 text-sm text-slate-600">No risk assessment is on file for this customer.</p>
      </section>
    );
  }
  return (
    <section className="card p-4" aria-labelledby="risk-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="risk-heading" className="font-semibold">
          Risk profile
        </h2>
        <Badge tone={riskTone(risk.riskLevel)}>{risk.riskLevel}</Badge>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {risk.riskScore}
        <span className="text-base font-normal text-slate-600"> / 100</span>
      </p>
      <div className="mt-2">
        <ProgressBar value={risk.riskScore} label={`Risk score ${risk.riskScore} out of 100`} tone="bg-amber-500" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-600">Investment horizon</dt>
        <dd className="text-right">{risk.horizonYears} years</dd>
        <dt className="text-slate-600">Liquidity need</dt>
        <dd className="text-right">{humanize(risk.liquidityNeed)}</dd>
        <dt className="text-slate-600">Assessed on</dt>
        <dd className="text-right">{formatDate(risk.assessedAt)}</dd>
      </dl>
    </section>
  );
}
