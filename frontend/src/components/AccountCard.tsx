import type { PortfolioAccount } from '../api/types';
import { formatINR, pnlClass } from '../lib/format';
import { humanize } from '../lib/options';
import { accountStatusTone } from '../lib/tones';
import { Badge } from './Badge';

export function AccountCard({ account }: { account: PortfolioAccount }) {
  const empty = account.positionCount === 0;
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{account.provider}</p>
          <p className="text-sm text-slate-600">
            {account.accountId} · {humanize(account.accountType)}
          </p>
        </div>
        <Badge tone={accountStatusTone(account.status)}>{humanize(account.status)}</Badge>
      </div>
      {empty ? (
        <p className="mt-4 text-sm text-slate-600">No holdings in the current snapshot.</p>
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-600">Market value</dt>
          <dd className="text-right font-medium tabular-nums">{formatINR(account.marketValue)}</dd>
          <dt className="text-slate-600">Unrealised P&amp;L</dt>
          <dd className={`text-right tabular-nums ${pnlClass(account.unrealisedPnl)}`}>{formatINR(account.unrealisedPnl, { signed: true })}</dd>
          <dt className="text-slate-600">Positions</dt>
          <dd className="text-right tabular-nums">{account.positionCount}</dd>
        </dl>
      )}
    </div>
  );
}
