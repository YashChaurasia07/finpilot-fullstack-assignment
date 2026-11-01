import { useState } from 'react';
import { usePortfolio } from '../api/hooks';
import type { Position } from '../api/types';
import { Badge } from '../components/Badge';
import { DataTable, type Column, type SortState } from '../components/DataTable';
import { QueryState } from '../components/QueryState';
import { StatCard } from '../components/StatCard';
import { daysBetween, formatDate, formatINR, formatNumber, formatPct, pnlClass, todayISO } from '../lib/format';
import { humanize } from '../lib/options';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useCustomerContext } from './customerContext';

// Sorting happens in the browser only because a customer has at most a few dozen positions;
// the numbers themselves were all calculated by the database.
const SORT_VALUE: Record<string, (p: Position) => number | string> = {
  symbol: (p) => p.symbol,
  accountId: (p) => p.accountId,
  assetClass: (p) => p.assetClass,
  quantity: (p) => Number(p.quantity),
  avgCost: (p) => Number(p.avgCost),
  lastPrice: (p) => Number(p.lastPrice),
  marketValue: (p) => Number(p.marketValue),
  unrealisedPnl: (p) => Number(p.unrealisedPnl),
};

const COLUMNS: Column<Position>[] = [
  {
    key: 'symbol',
    header: 'Instrument',
    sortable: true,
    cell: (p) => (
      <div>
        <div className="font-medium">{p.symbol}</div>
        <div className="text-xs text-slate-600">{p.instrumentName}</div>
      </div>
    ),
  },
  { key: 'accountId', header: 'Account', sortable: true, cell: (p) => p.accountId },
  { key: 'assetClass', header: 'Class', sortable: true, cell: (p) => <Badge tone="slate">{humanize(p.assetClass)}</Badge> },
  { key: 'quantity', header: 'Quantity', align: 'right', sortable: true, cell: (p) => formatNumber(p.quantity) },
  { key: 'avgCost', header: 'Avg cost', align: 'right', sortable: true, cell: (p) => formatINR(p.avgCost) },
  { key: 'lastPrice', header: 'Latest price', align: 'right', sortable: true, cell: (p) => formatINR(p.lastPrice) },
  { key: 'marketValue', header: 'Market value', align: 'right', sortable: true, cell: (p) => <span className="font-medium">{formatINR(p.marketValue)}</span> },
  {
    key: 'unrealisedPnl',
    header: 'Gain / loss',
    align: 'right',
    sortable: true,
    cell: (p) => (
      <div className={pnlClass(p.unrealisedPnl)}>
        <div>{formatINR(p.unrealisedPnl, { signed: true })}</div>
        <div className="text-xs">{p.unrealisedPnlPct === null ? '—' : formatPct(p.unrealisedPnlPct, { signed: true })}</div>
      </div>
    ),
  },
];

export function PortfolioTab() {
  useDocumentTitle('Portfolio');
  const { customer } = useCustomerContext();
  const query = usePortfolio(customer.customerId);
  const [accountId, setAccountId] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'marketValue', order: 'desc' });

  const toggleSort = (key: string) => setSort((s) => (s.key === key ? { key, order: s.order === 'asc' ? 'desc' : 'asc' } : { key, order: key === 'symbol' || key === 'accountId' || key === 'assetClass' ? 'asc' : 'desc' }));

  return (
    <QueryState query={query} isEmpty={(p) => p.positions.length === 0} loadingLabel="Loading positions…" empty={<div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-slate-700">This customer has no holdings in the current snapshot.</div>}>
      {(p) => {
        const account = p.accounts.find((a) => a.accountId === accountId);
        const shown = (accountId ? p.positions.filter((x) => x.accountId === accountId) : p.positions).slice();
        const value = SORT_VALUE[sort.key] ?? SORT_VALUE.marketValue;
        shown.sort((a, b) => {
          const [x, y] = [value(a), value(b)];
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return sort.order === 'asc' ? cmp : -cmp;
        });
        // Figures for the selected scope come straight from the API (account totals or customer totals).
        const scope = account ?? { ...p.totals, positionCount: p.totals.positionCount };
        const age = p.asOf.priceDate ? daysBetween(p.asOf.priceDate, todayISO()) : 0;

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-4">
              <StatCard label={account ? `Market value · ${account.accountId}` : 'Total market value'} value={formatINR(scope.marketValue)} />
              <StatCard label="Unrealised gain / loss" value={formatINR(scope.unrealisedPnl, { signed: true })} valueClassName={pnlClass(scope.unrealisedPnl)} />
              <StatCard label="Positions" value={scope.positionCount} />
              <StatCard label="Data freshness" value={formatDate(p.asOf.priceDate)} hint={`Snapshot ${formatDate(p.asOf.snapshotDate)}${age > 7 ? ` · ${age} days old` : ''}`} />
            </div>

            <div className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <h2 className="font-semibold">Positions</h2>
                {p.accounts.length > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="position-account">Account</label>
                    <select id="position-account" className="input w-auto py-1.5" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                      <option value="">All accounts</option>
                      {p.accounts.map((a) => (
                        <option key={a.accountId} value={a.accountId}>
                          {a.accountId} · {a.provider}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {shown.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-600">This account holds nothing in the current snapshot.</p>
              ) : (
                <DataTable caption="Positions" columns={COLUMNS} rows={shown} rowKey={(x) => `${x.accountId}-${x.instrumentId}`} sort={sort} onSort={toggleSort} />
              )}
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}
