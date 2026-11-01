import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { Spinner } from './Spinner';

export function EmptyState({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-600">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

function titleFor(error: ApiError | null): string {
  if (!error) return 'Something went wrong';
  if (error.status === 404) return 'Not found';
  if (error.status === 403) return 'Not allowed';
  if (error.status === 0) return 'Connection problem';
  if (error.status >= 500) return 'Server problem';
  return 'Something went wrong';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
      <p className="font-semibold">{titleFor(api)}</p>
      <p className="mt-1 text-sm">{api?.message ?? 'An unexpected error occurred. Please try again.'}</p>
      {api?.requestId && <p className="mt-2 text-xs text-rose-800">Reference for support: {api.requestId}</p>}
      {onRetry && (!api || api.retryable) && (
        <button type="button" className="btn btn-secondary mt-4" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

interface Props<T> {
  query: UseQueryResult<T>;
  /** When this returns true the empty state is shown instead of the children. */
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
}

/** One component for the four states of any request: loading, error (with retry), empty, and data. */
export function QueryState<T>({ query, isEmpty, empty, loadingLabel, children }: Props<T>) {
  if (query.isPending) return <Spinner label={loadingLabel} className="py-12" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="Nothing to show" />}</>;
  return (
    <div aria-busy={query.isFetching} className={query.isFetching ? 'opacity-70 transition-opacity' : undefined}>
      {children(query.data)}
    </div>
  );
}
