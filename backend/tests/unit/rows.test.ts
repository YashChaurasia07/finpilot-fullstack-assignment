import { describe, expect, it } from 'vitest';
import { isRealDate } from '../../src/lib/dates';
import { validateHolding, validateTransaction, type Raw } from '../../src/services/imports';

const TODAY = '2026-10-31';
const good: Raw = {
  transaction_id: 'T9000001',
  account_id: 'A00002',
  instrument_id: 'I0001',
  transaction_type: 'BUY',
  trade_date: '2026-09-10',
  quantity: '10',
  price: '450',
  amount: '4500',
  status: 'SETTLED',
};
const code = (raw: Raw) => {
  const r = validateTransaction(raw, TODAY);
  return 'code' in r ? r.code : 'OK';
};

describe('validateTransaction', () => {
  it('accepts a good row and keeps decimals as exact strings', () => {
    const r = validateTransaction({ ...good, quantity: '35.845', price: '172.72', amount: '6191.15' }, TODAY);
    expect(r).toEqual({
      value: expect.objectContaining({ transactionId: 'T9000001', quantity: '35.845', price: '172.72', amount: '6191.15', tradeDate: '2026-09-10' }),
    });
  });

  it('trims surrounding whitespace', () => {
    expect(code({ ...good, transaction_id: '  T9000001 ', status: ' SETTLED' })).toBe('OK');
  });

  it('accepts a trade dated today and cash events with zero quantity and price', () => {
    expect(code({ ...good, trade_date: TODAY })).toBe('OK');
    expect(code({ ...good, transaction_type: 'FEE', quantity: '0', price: '0', amount: '75' })).toBe('OK');
    expect(code({ ...good, transaction_type: 'DIVIDEND', quantity: '0.0', price: '0.00', amount: '12.5' })).toBe('OK');
  });

  it.each([
    ['empty id', { transaction_id: '' }, 'MISSING_VALUE'],
    ['missing column', { amount: undefined }, 'MISSING_VALUE'],
    ['id with a space', { transaction_id: 'T 1' }, 'INVALID_ID'],
    ['id too long', { transaction_id: 'T'.repeat(13) }, 'INVALID_ID'],
    ['id with SQL-ish characters', { account_id: "A1'; DROP" }, 'INVALID_ID'],
    ['lower-case type (no silent fixing)', { transaction_type: 'buy' }, 'INVALID_ENUM'],
    ['unknown type', { transaction_type: 'TRANSFER' }, 'INVALID_ENUM'],
    ['unknown status', { status: 'DONE' }, 'INVALID_ENUM'],
    ['impossible calendar date', { trade_date: '2026-02-30' }, 'INVALID_DATE'],
    ['month 13', { trade_date: '2026-13-01' }, 'INVALID_DATE'],
    ['wrong date format', { trade_date: '31/12/2026' }, 'INVALID_DATE'],
    ['date before 2000', { trade_date: '1999-12-31' }, 'INVALID_DATE'],
    ['a date in the future', { trade_date: '2027-01-05' }, 'FUTURE_DATE'],
    ['tomorrow', { trade_date: '2026-11-01' }, 'FUTURE_DATE'],
    ['text in a number', { quantity: 'abc' }, 'INVALID_NUMBER'],
    ['exponent notation', { quantity: '1e3' }, 'INVALID_NUMBER'],
    ['thousands separator', { amount: '1,000' }, 'INVALID_NUMBER'],
    ['plus sign', { price: '+5' }, 'INVALID_NUMBER'],
    ['3 decimals in a price (no silent rounding)', { price: '1.234' }, 'INVALID_NUMBER'],
    ['5 decimals in a quantity', { quantity: '1.23456' }, 'INVALID_NUMBER'],
    ['13-digit amount (would overflow NUMERIC)', { amount: '1234567890123' }, 'INVALID_NUMBER'],
    ['negative amount', { transaction_type: 'FEE', quantity: '0', price: '0', amount: '-75' }, 'NEGATIVE_VALUE'],
    ['negative zero', { amount: '-0' }, 'NEGATIVE_VALUE'],
    ['BUY with zero quantity', { quantity: '0' }, 'INVALID_TRADE_VALUES'],
    ['SELL with zero price', { transaction_type: 'SELL', price: '0' }, 'INVALID_TRADE_VALUES'],
  ])('rejects %s', (_label, change, expected) => {
    expect(code({ ...good, ...change })).toBe(expected);
  });

  it('explains which field is wrong', () => {
    const r = validateTransaction({ ...good, amount: '-75' }, TODAY);
    expect(r).toEqual({ code: 'NEGATIVE_VALUE', detail: 'amount = -75 — must not be negative' });
  });
});

describe('validateHolding', () => {
  const holding: Raw = { account_id: 'A00002', instrument_id: 'I0046', quantity: '161.16', avg_cost: '133.18', snapshot_date: '2026-09-18' };
  const holdingCode = (raw: Raw) => {
    const r = validateHolding(raw, TODAY);
    return 'code' in r ? r.code : 'OK';
  };

  it('accepts a good row', () => expect(holdingCode(holding)).toBe('OK'));
  it.each([
    ['zero quantity', { quantity: '0' }, 'INVALID_NUMBER'],
    ['negative cost', { avg_cost: '-1' }, 'NEGATIVE_VALUE'],
    ['future snapshot', { snapshot_date: '2027-01-01' }, 'FUTURE_DATE'],
    ['bad snapshot date', { snapshot_date: 'yesterday' }, 'INVALID_DATE'],
    ['missing instrument', { instrument_id: '' }, 'MISSING_VALUE'],
  ])('rejects %s', (_label, change, expected) => expect(holdingCode({ ...holding, ...change })).toBe(expected));
});

describe('isRealDate', () => {
  it.each(['2026-01-31', '2024-02-29', '2000-01-01'])('accepts %s', (d) => expect(isRealDate(d)).toBe(true));
  it.each(['2026-02-29', '2026-04-31', '2026-00-10', '2026-1-1', '26-01-01', '', 'abc', '2026-01-01T00:00:00Z', '0099-01-01'])('rejects "%s"', (d) =>
    expect(isRealDate(d)).toBe(false),
  );
});
