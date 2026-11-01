import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, dateRangeError, parseTransactionFilters, toSearchParams } from './params';

const parse = (qs: string) => parseTransactionFilters(new URLSearchParams(qs));

describe('parseTransactionFilters (the URL is untrusted input)', () => {
  it('gives the defaults for an empty URL', () => expect(parse('')).toEqual(DEFAULT_FILTERS));

  it('reads valid values', () => {
    expect(parse('page=3&pageSize=50&from=2026-01-01&to=2026-06-30&accountId=A00002&instrumentId=I0046&type=BUY&status=PENDING&sortBy=amount&order=asc')).toEqual({
      page: 3, pageSize: 50, from: '2026-01-01', to: '2026-06-30', accountId: 'A00002', instrumentId: 'I0046', type: 'BUY', status: 'PENDING', sortBy: 'amount', order: 'asc',
    });
  });

  it.each([
    ['page=abc', 'page'],
    ['page=0', 'page'],
    ['page=-4', 'page'],
    ['page=1.5', 'page'],
    ['page=99999999', 'page'],
    ['pageSize=7', 'pageSize'],
    ['pageSize=1000', 'pageSize'],
    ['from=2026-02-30', 'from'],
    ['from=yesterday', 'from'],
    ['to=2026-13-01', 'to'],
    ['accountId=A1%27%20OR%201=1', 'accountId'],
    ['instrumentId=' + 'X'.repeat(40), 'instrumentId'],
    ['type=TRANSFER', 'type'],
    ['type=buy', 'type'],
    ['status=DONE', 'status'],
    ['sortBy=hack', 'sortBy'],
    ['order=sideways', 'order'],
  ])('falls back to the default for %s', (qs, key) => {
    const parsed = parse(qs);
    expect(parsed[key as keyof typeof parsed]).toBe(DEFAULT_FILTERS[key as keyof typeof DEFAULT_FILTERS]);
  });

  it('survives repeated parameters', () => expect(parse('type=BUY&type=SELL').type).toBe('BUY'));
});

describe('toSearchParams', () => {
  it('omits defaults so shared links stay short', () => {
    expect(toSearchParams(DEFAULT_FILTERS).toString()).toBe('');
    expect(toSearchParams({ ...DEFAULT_FILTERS, type: 'SELL', page: 2 }).toString()).toBe('page=2&type=SELL');
  });
  it('round-trips through parse', () => {
    const filters = { ...DEFAULT_FILTERS, from: '2026-01-01', status: 'REVERSED' as const, pageSize: 100, order: 'asc' as const };
    expect(parse(toSearchParams(filters).toString())).toEqual(filters);
  });
});

describe('dateRangeError', () => {
  it('flags an inverted range only', () => {
    expect(dateRangeError({ from: '2026-06-30', to: '2026-01-01' })).toMatch(/end date/i);
    expect(dateRangeError({ from: '2026-01-01', to: '2026-01-01' })).toBeNull();
    expect(dateRangeError({ from: '2026-01-01', to: '' })).toBeNull();
    expect(dateRangeError({ from: '', to: '' })).toBeNull();
  });
});
