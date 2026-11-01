import { TX_STATUSES, TX_TYPES, type TransactionStatus, type TransactionType } from './options';

/**
 * Filters live in the URL (shareable, survives refresh and the back button). Anything typed or pasted into
 * the address bar is untrusted, so every value is validated here and falls back to a safe default instead of
 * sending the API a request it would reject.
 */
export interface TransactionFilters {
  page: number;
  pageSize: number;
  from: string;
  to: string;
  accountId: string;
  instrumentId: string;
  type: TransactionType | '';
  status: TransactionStatus | '';
  sortBy: 'tradeDate' | 'amount';
  order: 'asc' | 'desc';
}

export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_FILTERS: TransactionFilters = {
  page: 1,
  pageSize: 20,
  from: '',
  to: '',
  accountId: '',
  instrumentId: '',
  type: '',
  status: '',
  sortBy: 'tradeDate',
  order: 'desc',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{1,12}$/;

function realDate(value: string | null): string {
  if (!value || !ISO_DATE.test(value)) return '';
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value) ? value : '';
}

const oneOf = <T extends string>(allowed: readonly T[], value: string | null): T | '' => (allowed.find((a) => a === value) ?? '');

export function parseTransactionFilters(sp: URLSearchParams): TransactionFilters {
  const page = Number(sp.get('page'));
  const size = Number(sp.get('pageSize'));
  const accountId = sp.get('accountId') ?? '';
  const instrumentId = sp.get('instrumentId') ?? '';
  return {
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
    pageSize: PAGE_SIZES.find((s) => s === size) ?? DEFAULT_FILTERS.pageSize,
    from: realDate(sp.get('from')),
    to: realDate(sp.get('to')),
    accountId: ID.test(accountId) ? accountId : '',
    instrumentId: ID.test(instrumentId) ? instrumentId : '',
    type: oneOf(TX_TYPES, sp.get('type')),
    status: oneOf(TX_STATUSES, sp.get('status')),
    sortBy: sp.get('sortBy') === 'amount' ? 'amount' : 'tradeDate',
    order: sp.get('order') === 'asc' ? 'asc' : 'desc',
  };
}

/** Only non-default values go in the URL, which keeps shared links short. */
export function toSearchParams(filters: TransactionFilters): URLSearchParams {
  const sp = new URLSearchParams();
  for (const key of Object.keys(DEFAULT_FILTERS) as (keyof TransactionFilters)[]) {
    if (filters[key] !== DEFAULT_FILTERS[key]) sp.set(key, String(filters[key]));
  }
  return sp;
}

/** The API rejects from > to; catch it in the form first. */
export const dateRangeError = (f: Pick<TransactionFilters, 'from' | 'to'>): string | null =>
  f.from && f.to && f.from > f.to ? 'The end date must be on or after the start date.' : null;
