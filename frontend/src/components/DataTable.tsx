import { memo, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'right';
  sortable?: boolean;
}

export interface SortState {
  key: string;
  order: 'asc' | 'desc';
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: SortState;
  onSort?: (key: string) => void;
  rowClassName?: (row: T) => string | undefined;
}

function DataTableBase<T>({ caption, columns, rows, rowKey, sort, onSort, rowClassName }: Props<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => {
              const active = sort !== undefined && sort.key === col.key;
              const ariaSort = !col.sortable ? undefined : active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {col.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-1 uppercase hover:text-indigo-700">
                      {col.header}
                      <span aria-hidden="true">{active ? (sort.order === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={rowKey(row)} className={rowClassName?.(row)}>
              {columns.map((col) => (
                <td key={col.key} className={`px-3 py-2.5 align-middle ${col.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Memoised so a re-render of the page (e.g. typing in a filter) does not rebuild an unchanged table. */
export const DataTable = memo(DataTableBase) as typeof DataTableBase;
