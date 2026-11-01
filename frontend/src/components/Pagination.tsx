import { useId } from 'react';
import { PAGE_SIZES } from '../lib/params';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}

export function Pagination({ page, pageSize, total, totalPages, onPage, onPageSize }: Props) {
  const sizeId = useId();
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-3 text-sm text-slate-700">
      <p aria-live="polite">
        {total === 0 ? 'No results' : `Showing ${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSize && (
          <div className="flex items-center gap-2">
            <label htmlFor={sizeId}>Rows per page</label>
            <select id={sizeId} className="input w-auto py-1.5" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
        <span>
          Page {totalPages === 0 ? 0 : page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <button type="button" className="btn btn-secondary py-1.5" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      </div>
    </nav>
  );
}
