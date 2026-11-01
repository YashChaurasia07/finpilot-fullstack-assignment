import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useInstruments, useTransactions } from '../api/hooks';
import type { Transaction } from '../api/types';
import { Badge } from '../components/Badge';
import { DataTable, type Column, type SortState } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { EmptyState, QueryState } from '../components/QueryState';
import { formatDate, formatINR, formatNumber } from '../lib/format';
import { TX_STATUSES, TX_TYPES, humanize } from '../lib/options';
import { DEFAULT_FILTERS, dateRangeError, parseTransactionFilters, toSearchParams, type TransactionFilters } from '../lib/params';
import { txStatusTone, txTypeTone } from '../lib/tones';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useCustomerContext } from './customerContext';

const COLUMNS: Column<Transaction>[] = [
  { key: 'tradeDate', header: 'Date', sortable: true, cell: (t) => formatDate(t.tradeDate) },
  { key: 'transactionId', header: 'Transaction', cell: (t) => <span className="font-mono text-xs">{t.transactionId}</span> },
  { key: 'accountId', header: 'Account', cell: (t) => t.accountId },
  {
    key: 'instrument',
    header: 'Instrument',
    cell: (t) => (
      <div>
        <div className="font-medium">{t.symbol}</div>
        <div className="text-xs text-slate-600">{t.instrumentName}</div>
      </div>
    ),
  },
  { key: 'type', header: 'Type', cell: (t) => <Badge tone={txTypeTone(t.transactionType)}>{humanize(t.transactionType)}</Badge> },
  { key: 'quantity', header: 'Quantity', align: 'right', cell: (t) => (Number(t.quantity) === 0 ? '—' : formatNumber(t.quantity)) },
  { key: 'price', header: 'Price', align: 'right', cell: (t) => (Number(t.price) === 0 ? '—' : formatINR(t.price)) },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    sortable: true,
    cell: (t) => <span className={t.status === 'REVERSED' ? 'text-slate-500 line-through' : 'font-medium'}>{formatINR(t.amount)}</span>,
  },
  { key: 'status', header: 'Status', cell: (t) => <Badge tone={txStatusTone(t.status)}>{humanize(t.status)}</Badge> },
];

// Pending and reversed rows are tinted (and labelled) so they stand out from settled activity.
const rowClass = (t: Transaction) => (t.status === 'PENDING' ? 'bg-amber-50/70' : t.status === 'REVERSED' ? 'bg-rose-50/60 text-slate-600' : undefined);

export function TransactionsTab() {
  useDocumentTitle('Transactions');
  const { customer } = useCustomerContext();
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => parseTransactionFilters(sp), [sp]);
  const rangeError = dateRangeError(filters);
  const instruments = useInstruments();
  const query = useTransactions(customer.customerId, filters, !rangeError);

  // Every change goes into the URL (so it can be shared and survives a refresh); any filter change returns to page 1.
  const update = (patch: Partial<TransactionFilters>) => setSp(toSearchParams({ ...filters, page: 1, ...patch }), { replace: true });
  const sort: SortState = { key: filters.sortBy, order: filters.order };
  const toggleSort = (key: string) => {
    const sortBy = key === 'amount' ? 'amount' : 'tradeDate';
    update({ sortBy, order: sortBy === filters.sortBy && filters.order === 'desc' ? 'asc' : 'desc' });
  };
  const filtered = JSON.stringify({ ...filters, page: 1, pageSize: 1 }) !== JSON.stringify({ ...DEFAULT_FILTERS, page: 1, pageSize: 1 });

  return (
    <div className="space-y-4">
      <form role="search" aria-label="Filter transactions" onSubmit={(e) => e.preventDefault()} className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="tx-from" className="label">
            From
          </label>
          <input id="tx-from" type="date" className="input" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div>
          <label htmlFor="tx-to" className="label">
            To
          </label>
          <input id="tx-to" type="date" className="input" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} aria-invalid={Boolean(rangeError)} aria-describedby={rangeError ? 'tx-range-error' : undefined} />
        </div>
        <div>
          <label htmlFor="tx-account" className="label">
            Account
          </label>
          <select id="tx-account" className="input" value={filters.accountId} onChange={(e) => update({ accountId: e.target.value })}>
            <option value="">All accounts</option>
            {customer.accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.accountId} · {a.provider}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tx-instrument" className="label">
            Instrument
          </label>
          <select id="tx-instrument" className="input" value={filters.instrumentId} onChange={(e) => update({ instrumentId: e.target.value })} disabled={instruments.isPending}>
            <option value="">{instruments.isPending ? 'Loading…' : instruments.isError ? 'Could not load instruments' : 'All instruments'}</option>
            {instruments.data?.map((i) => (
              <option key={i.instrumentId} value={i.instrumentId}>
                {i.symbol} · {i.instrumentName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tx-type" className="label">
            Type
          </label>
          <select id="tx-type" className="input" value={filters.type} onChange={(e) => update({ type: e.target.value as TransactionFilters['type'] })}>
            <option value="">All types</option>
            {TX_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tx-status" className="label">
            Status
          </label>
          <select id="tx-status" className="input" value={filters.status} onChange={(e) => update({ status: e.target.value as TransactionFilters['status'] })}>
            <option value="">All statuses</option>
            {TX_STATUSES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end sm:col-span-2">
          <button type="button" className="btn btn-secondary" onClick={() => setSp({}, { replace: true })} disabled={!filtered}>
            Reset filters
          </button>
        </div>
        {rangeError && (
          <p id="tx-range-error" role="alert" className="text-sm text-rose-700 sm:col-span-2 lg:col-span-4">
            {rangeError}
          </p>
        )}
      </form>

      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>Row colours:</span>
        <Badge tone="amber">Pending</Badge>
        <Badge tone="rose">Reversed (amount struck through)</Badge>
      </p>

      <div className="card overflow-hidden">
        {rangeError ? (
          <p className="px-4 py-10 text-center text-sm text-slate-600">Fix the date range to see transactions.</p>
        ) : (
          <QueryState query={query} loadingLabel="Loading transactions…">
            {({ data, meta }) =>
              data.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={meta && meta.total > 0 ? 'No results on this page' : filtered ? 'No transactions match these filters' : 'This customer has no transactions'}
                    hint={meta && meta.total > 0 ? 'The page number is beyond the last page.' : filtered ? 'Try widening the date range or clearing a filter.' : undefined}
                    action={
                      meta && meta.total > 0 ? (
                        <button type="button" className="btn btn-secondary" onClick={() => update({ page: 1 })}>
                          Go to the first page
                        </button>
                      ) : filtered ? (
                        <button type="button" className="btn btn-secondary" onClick={() => setSp({}, { replace: true })}>
                          Reset filters
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <>
                  <DataTable caption="Transactions" columns={COLUMNS} rows={data} rowKey={(t) => t.transactionId} sort={sort} onSort={toggleSort} rowClassName={rowClass} />
                  {meta && <Pagination {...meta} onPage={(page) => update({ page })} onPageSize={(pageSize) => update({ pageSize, page: 1 })} />}
                </>
              )
            }
          </QueryState>
        )}
      </div>
    </div>
  );
}
