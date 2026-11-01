import { Link, NavLink, Outlet, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useCustomer } from '../api/hooks';
import { Badge } from '../components/Badge';
import { QueryState } from '../components/QueryState';
import { humanize } from '../lib/options';
import { kycTone, segmentTone } from '../lib/tones';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import type { CustomerContext } from './customerContext';

const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'portfolio', label: 'Portfolio' },
  { to: 'transactions', label: 'Transactions' },
  { to: 'goals', label: 'Goals' },
];

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm font-medium sm:px-4 ${isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'}`;

export function CustomerLayout() {
  const { customerId = '' } = useParams();
  const query = useCustomer(customerId);
  useDocumentTitle(query.data?.fullName ?? 'Customer');

  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div role="alert" className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-xl font-semibold">Customer not found</h1>
        <p className="mt-2 text-slate-600">There is no customer with the ID “{customerId}”.</p>
        <Link to="/customers" className="btn btn-primary mt-6">
          Back to customers
        </Link>
      </div>
    );
  }

  return (
    <QueryState query={query} loadingLabel="Loading customer…">
      {(customer) => (
        <div>
          <Link to="/customers" className="text-sm text-indigo-700 hover:underline">
            ← All customers
          </Link>
          <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold">{customer.fullName}</h1>
              <p className="mt-1 text-sm text-slate-600">
                {customer.customerId} · {customer.city}, {customer.state} · {customer.email} · {customer.phone}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={kycTone(customer.kycStatus)} title="KYC status">
                KYC {humanize(customer.kycStatus).toLowerCase()}
              </Badge>
              <Badge tone={segmentTone(customer.segment)} title="Segment">
                {humanize(customer.segment)}
              </Badge>
            </div>
          </header>

          <nav aria-label="Customer sections" className="mt-5 flex overflow-x-auto border-b border-slate-200">
            {TABS.map((tab) => (
              <NavLink key={tab.label} to={tab.to} end={tab.end} className={tabClass}>
                {tab.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6">
            <Outlet context={{ customer } satisfies CustomerContext} />
          </div>
        </div>
      )}
    </QueryState>
  );
}
