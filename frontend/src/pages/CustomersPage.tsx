import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useCustomers } from '../api/hooks';
import type { CustomerSummary } from '../api/types';
import { Badge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { Pagination } from '../components/Pagination';
import { EmptyState, QueryState } from '../components/QueryState';
import { humanize } from '../lib/options';
import { PAGE_SIZES } from '../lib/params';
import { kycTone, segmentTone } from '../lib/tones';
import { useDocumentTitle } from '../lib/useDocumentTitle';

const COLUMNS: Column<CustomerSummary>[] = [
  {
    key: 'customerId',
    header: 'Customer ID',
    cell: (c) => (
      <Link to={`/customers/${c.customerId}`} className="font-medium text-indigo-700 hover:underline">
        {c.customerId}
      </Link>
    ),
  },
  {
    key: 'fullName',
    header: 'Name',
    cell: (c) => (
      <Link to={`/customers/${c.customerId}`} className="hover:underline">
        {c.fullName}
      </Link>
    ),
  },
  { key: 'email', header: 'Email', cell: (c) => <span className="text-slate-700">{c.email}</span> },
  { key: 'city', header: 'City', cell: (c) => `${c.city}, ${c.state}` },
  { key: 'segment', header: 'Segment', cell: (c) => <Badge tone={segmentTone(c.segment)}>{humanize(c.segment)}</Badge> },
  { key: 'kyc', header: 'KYC', cell: (c) => <Badge tone={kycTone(c.kycStatus)}>{humanize(c.kycStatus)}</Badge> },
];

export function CustomersPage() {
  useDocumentTitle('Customers');
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const pageParam = Number(sp.get('page'));
  const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
  const sizeParam = Number(sp.get('pageSize'));
  const pageSize = PAGE_SIZES.find((s) => s === sizeParam) ?? 20;

  // The box shows what is typed; the URL (and so the request) follows 300 ms after typing stops.
  const [text, setText] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q); // the URL changed on its own (back button, link): mirror it in the box
    setText(q);
  }
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === q) return;
    const timer = setTimeout(() => setSp(trimmed ? { q: trimmed } : {}, { replace: true }), 300);
    return () => clearTimeout(timer);
  }, [text, q, setSp]);

  const go = (next: { page?: number; pageSize?: number }) => {
    const params: Record<string, string> = {};
    if (q) params.q = q;
    const p = next.page ?? page;
    const s = next.pageSize ?? pageSize;
    if (p !== 1) params.page = String(p);
    if (s !== 20) params.pageSize = String(s);
    setSp(params);
  };

  const query = useCustomers({ q, page, pageSize });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Customers</h1>
      <p className="mt-1 text-slate-600">Find a customer by ID, name, email or city.</p>

      <div className="mt-4 max-w-md">
        <label htmlFor="customer-search" className="label">
          Search customers
        </label>
        <input
          id="customer-search"
          type="search"
          className="input"
          placeholder="e.g. C0002, Sharma, Pune"
          maxLength={100}
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="card mt-4 overflow-hidden">
        <QueryState query={query} loadingLabel="Loading customers…">
          {({ data, meta }) =>
            data.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={q ? `No customers match “${q}”` : 'No customers found'}
                  hint={meta && meta.total > 0 ? 'There are no results on this page.' : 'Try a different ID, name, email or city.'}
                  action={
                    q || page > 1 ? (
                      <button type="button" className="btn btn-secondary" onClick={() => setSp({})}>
                        {q ? 'Clear search' : 'Go to the first page'}
                      </button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <>
                <DataTable caption="Customers" columns={COLUMNS} rows={data} rowKey={(c) => c.customerId} />
                {meta && <Pagination {...meta} onPage={(p) => go({ page: p })} onPageSize={(s) => go({ pageSize: s, page: 1 })} />}
              </>
            )
          }
        </QueryState>
      </div>
    </div>
  );
}
