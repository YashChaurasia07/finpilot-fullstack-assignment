import { lazy, Suspense } from 'react';
import { Link } from 'react-router';
import { useGoals, usePortfolio } from '../api/hooks';
import type { Portfolio } from '../api/types';
import { AccountCard } from '../components/AccountCard';
import { Badge } from '../components/Badge';
import { GoalCard } from '../components/GoalCard';
import { EmptyState, QueryState } from '../components/QueryState';
import { RiskCard } from '../components/RiskCard';
import { Spinner } from '../components/Spinner';
import { StatCard } from '../components/StatCard';
import { daysBetween, formatDate, formatINR, formatPct, pnlClass, todayISO } from '../lib/format';
import { useCustomerContext } from './customerContext';

// Recharts is the heaviest dependency, so the chart is fetched as its own chunk after the page shell renders.
const AllocationChart = lazy(() => import('../components/AllocationChart').then((m) => ({ default: m.AllocationChart })));

/** How old the price data is, so nobody mistakes a stale snapshot for live numbers. */
function Freshness({ asOf }: { asOf: Portfolio['asOf'] }) {
  if (!asOf.snapshotDate) return null;
  const age = daysBetween(asOf.priceDate ?? asOf.snapshotDate, todayISO());
  const stale = age > 7;
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
      <span>
        Holdings snapshot: <strong>{formatDate(asOf.snapshotDate)}</strong>
      </span>
      <span>
        Prices as of: <strong>{formatDate(asOf.priceDate)}</strong>
      </span>
      <Badge tone={stale ? 'amber' : 'green'}>{stale ? `Prices are ${age} days old` : 'Prices are current'}</Badge>
    </p>
  );
}

function Totals({ customerId }: { customerId: string }) {
  const query = usePortfolio(customerId);
  return (
    <QueryState query={query} loadingLabel="Loading portfolio…">
      {(p) => (
        <div className="space-y-4">
          <Freshness asOf={p.asOf} />
          <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total market value" value={formatINR(p.totals.marketValue)} hint="Current holdings × latest prices" />
            <StatCard label="Cost of holdings" value={formatINR(p.totals.costValue)} />
            <StatCard
              label="Unrealised gain / loss"
              value={formatINR(p.totals.unrealisedPnl, { signed: true })}
              valueClassName={pnlClass(p.totals.unrealisedPnl)}
              hint={p.totals.unrealisedPnlPct === null ? undefined : formatPct(p.totals.unrealisedPnlPct, { signed: true })}
            />
            <StatCard label="Positions" value={p.totals.positionCount} hint={`${p.accounts.length} ${p.accounts.length === 1 ? 'account' : 'accounts'}`} />
          </div>

          <section aria-labelledby="accounts-heading">
            <h2 id="accounts-heading" className="mb-3 mt-6 text-lg font-semibold">
              Accounts
            </h2>
            {p.accounts.length === 0 ? (
              <EmptyState title="This customer has no accounts" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {p.accounts.map((a) => (
                  <AccountCard key={a.accountId} account={a} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </QueryState>
  );
}

function Allocation({ customerId }: { customerId: string }) {
  const query = usePortfolio(customerId);
  return (
    <section className="card p-4" aria-labelledby="allocation-heading">
      <h2 id="allocation-heading" className="mb-3 font-semibold">
        Allocation by asset class
      </h2>
      <QueryState query={query} isEmpty={(p) => p.allocation.length === 0} empty={<p className="py-8 text-center text-sm text-slate-600">No holdings to chart.</p>} loadingLabel="Loading chart…">
        {(p) => (
          <Suspense fallback={<Spinner label="Loading chart…" className="py-12" />}>
            <AllocationChart slices={p.allocation} />
          </Suspense>
        )}
      </QueryState>
    </section>
  );
}

function GoalSummary({ customerId }: { customerId: string }) {
  const query = useGoals(customerId);
  return (
    <section className="card p-4" aria-labelledby="goals-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="goals-heading" className="font-semibold">
          Goals
        </h2>
        <Link to="goals" className="text-sm text-indigo-700 hover:underline">
          View all
        </Link>
      </div>
      <QueryState query={query} isEmpty={(g) => g.length === 0} empty={<p className="py-6 text-center text-sm text-slate-600">No goals have been set up yet.</p>} loadingLabel="Loading goals…">
        {(goals) => (
          <div className="space-y-3">
            {goals.slice(0, 2).map((g) => (
              <GoalCard key={g.goalId} goal={g} />
            ))}
            {goals.length > 2 && <p className="text-center text-sm text-slate-600">+ {goals.length - 2} more</p>}
          </div>
        )}
      </QueryState>
    </section>
  );
}

export function OverviewTab() {
  const { customer } = useCustomerContext();
  return (
    <div className="space-y-6">
      <Totals customerId={customer.customerId} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Allocation customerId={customer.customerId} />
        <RiskCard risk={customer.riskProfile} />
        <GoalSummary customerId={customer.customerId} />
      </div>
    </div>
  );
}
