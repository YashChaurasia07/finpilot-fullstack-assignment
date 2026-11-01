import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { API, customerWhere, expectFailure, expectSuccess, pool, signIn } from '../helpers';

const app = createApp();
let agent: Awaited<ReturnType<typeof signIn>>;
let customer: string; // a customer with plenty of transactions across more than one account
let accountIds: string[];

type Tx = { transactionId: string; accountId: string; instrumentId: string; symbol: string; transactionType: string; tradeDate: string; amount: string; status: string };
const list = (qs: Record<string, string | number | undefined> = {}, id = customer) => agent.get(`${API}/customers/${id}/transactions`).query(qs);

/** Independent count straight from the tables, for the same filters. */
async function sqlCount(where = 'true', params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(
    `select count(*)::int n from transactions t join accounts a using (account_id) where a.customer_id = $1 and ${where}`,
    [customer, ...params],
  );
  return rows[0].n;
}

beforeAll(async () => {
  agent = await signIn(app, 'viewer');
  customer = await customerWhere(
    `(select count(distinct a.account_id) from accounts a join transactions t using (account_id) where a.customer_id = c.customer_id) >= 2
     and (select count(*) from transactions t join accounts a using (account_id) where a.customer_id = c.customer_id) > 40`,
  );
  accountIds = (await pool.query('select account_id from accounts where customer_id = $1 order by 1', [customer])).rows.map((r) => r.account_id);
});

describe('GET /customers/:id/transactions', () => {
  it('returns one page, newest first, with joined instrument details and exact pagination meta', async () => {
    const res = await list({ pageSize: 10 }).expect(200);
    const rows = expectSuccess(res.body) as Tx[];
    const total = await sqlCount();
    expect(rows).toHaveLength(10);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total, totalPages: Math.ceil(total / 10) });
    expect(rows[0]).toEqual({
      transactionId: expect.any(String), accountId: expect.any(String), instrumentId: expect.any(String),
      symbol: expect.any(String), instrumentName: expect.any(String), transactionType: expect.any(String),
      tradeDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), quantity: expect.any(String), price: expect.any(String),
      amount: expect.any(String), status: expect.any(String),
    });
    const dates = rows.map((r) => r.tradeDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('pages never overlap and together equal the full sorted list', async () => {
    const all = (await list({ pageSize: 100 }).expect(200)).body.data as Tx[];
    const pageA = (await list({ pageSize: 7, page: 1 }).expect(200)).body.data as Tx[];
    const pageB = (await list({ pageSize: 7, page: 2 }).expect(200)).body.data as Tx[];
    const pageC = (await list({ pageSize: 7, page: 3 }).expect(200)).body.data as Tx[];
    expect([...pageA, ...pageB, ...pageC].map((t) => t.transactionId)).toEqual(all.slice(0, 21).map((t) => t.transactionId));
  });

  it('only ever shows this customer’s transactions', async () => {
    const all = (await list({ pageSize: 100 }).expect(200)).body.data as Tx[];
    expect(all.every((t) => accountIds.includes(t.accountId))).toBe(true);
  });

  it.each([
    ['type', { type: 'BUY' }, "t.transaction_type = 'BUY'", (t: Tx) => t.transactionType === 'BUY'],
    ['status', { status: 'PENDING' }, "t.status = 'PENDING'", (t: Tx) => t.status === 'PENDING'],
    ['status REVERSED', { status: 'REVERSED' }, "t.status = 'REVERSED'", (t: Tx) => t.status === 'REVERSED'],
    ['date range', { from: '2026-01-01', to: '2026-06-30' }, "t.trade_date between '2026-01-01' and '2026-06-30'", (t: Tx) => t.tradeDate >= '2026-01-01' && t.tradeDate <= '2026-06-30'],
    ['from only', { from: '2026-06-01' }, "t.trade_date >= '2026-06-01'", (t: Tx) => t.tradeDate >= '2026-06-01'],
    ['to only', { to: '2025-12-31' }, "t.trade_date <= '2025-12-31'", (t: Tx) => t.tradeDate <= '2025-12-31'],
    ['combined', { type: 'SELL', status: 'SETTLED', from: '2025-06-01' }, "t.transaction_type = 'SELL' and t.status = 'SETTLED' and t.trade_date >= '2025-06-01'", (t: Tx) => t.transactionType === 'SELL' && t.status === 'SETTLED' && t.tradeDate >= '2025-06-01'],
  ])('filters by %s (and the total matches SQL)', async (_label, filter, where, matches) => {
    const res = await list({ ...filter, pageSize: 100 }).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every(matches)).toBe(true);
    expect(res.body.meta.total).toBe(await sqlCount(where));
  });

  it('filters by account and by instrument', async () => {
    const account = accountIds[0];
    const byAccount = await list({ accountId: account, pageSize: 100 }).expect(200);
    expect(byAccount.body.data.every((t: Tx) => t.accountId === account)).toBe(true);
    expect(byAccount.body.meta.total).toBe(await sqlCount('t.account_id = $2', [account]));

    const instrument = byAccount.body.data[0].instrumentId;
    const byInstrument = await list({ instrumentId: instrument, pageSize: 100 }).expect(200);
    expect(byInstrument.body.data.every((t: Tx) => t.instrumentId === instrument)).toBe(true);
    expect(byInstrument.body.meta.total).toBe(await sqlCount('t.instrument_id = $2', [instrument]));
  });

  it('date range is inclusive at both ends', async () => {
    const day = (await list({ pageSize: 1 }).expect(200)).body.data[0].tradeDate as string;
    const res = await list({ from: day, to: day, pageSize: 100 }).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t: Tx) => t.tradeDate === day)).toBe(true);
  });

  it('sorts by amount, both directions, with a stable tie-break', async () => {
    const asc = (await list({ sortBy: 'amount', order: 'asc', pageSize: 100 }).expect(200)).body.data as Tx[];
    const amounts = asc.map((t) => Number(t.amount));
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
    const desc = (await list({ sortBy: 'amount', order: 'desc', pageSize: 100 }).expect(200)).body.data as Tx[];
    expect(desc.map((t) => Number(t.amount))).toEqual([...amounts].sort((a, b) => b - a));
    const oldest = (await list({ sortBy: 'tradeDate', order: 'asc', pageSize: 5 }).expect(200)).body.data as Tx[];
    expect(oldest.map((t) => t.tradeDate)).toEqual([...oldest.map((t) => t.tradeDate)].sort());
  });

  it('shows reversed and pending rows with their status so the UI can mark them', async () => {
    const all = (await list({ pageSize: 100 }).expect(200)).body.data as Tx[];
    expect(new Set(all.map((t) => t.status))).toEqual(expect.objectContaining(new Set(['SETTLED'])));
    expect(all.some((t) => t.status !== 'SETTLED')).toBe(true);
  });

  it('well-formed filters that match nothing give an empty page, not an error', async () => {
    for (const qs of [{ instrumentId: 'I9999' }, { accountId: 'A99999' }, { from: '2099-01-01' }, { page: 999 }]) {
      const res = await list(qs).expect(200);
      expect(res.body.data).toEqual([]);
    }
  });

  it('an account that belongs to another customer is never exposed', async () => {
    const other = (await pool.query('select account_id from accounts where customer_id <> $1 order by 1 limit 1', [customer])).rows[0].account_id;
    expect((await list({ accountId: other }).expect(200)).body).toMatchObject({ data: [], meta: { total: 0 } });
  });

  it('blank filter values are ignored', async () => {
    const res = await list({ type: '', status: '', from: '', to: '', accountId: '', instrumentId: '', sortBy: '', order: '' }).expect(200);
    expect(res.body.meta.total).toBe(await sqlCount());
  });

  it.each([
    ['unknown type', { type: 'TRANSFER' }, 'type'],
    ['lower-case type', { type: 'buy' }, 'type'],
    ['unknown status', { status: 'DONE' }, 'status'],
    ['impossible date', { from: '2026-02-30' }, 'from'],
    ['wrong date format', { to: '31/12/2026' }, 'to'],
    ['from after to', { from: '2026-06-30', to: '2026-01-01' }, 'to'],
    ['bad sort column', { sortBy: 'amount; drop table transactions' }, 'sortBy'],
    ['bad order', { order: 'sideways' }, 'order'],
    ['SQL in accountId', { accountId: "A00001' OR '1'='1" }, 'accountId'],
    ['SQL in instrumentId', { instrumentId: '1; select 1' }, 'instrumentId'],
    ['pageSize too big', { pageSize: 500 }, 'pageSize'],
    ['page zero', { page: 0 }, 'page'],
  ])('400 for %s', async (_label, qs, field) => {
    const res = await list(qs).expect(400);
    const error = expectFailure(res.body, 'VALIDATION_ERROR');
    expect((error.details as { field: string }[]).map((d) => d.field)).toContain(field);
    expect((await pool.query('select count(*)::int n from transactions')).rows[0].n).toBeGreaterThan(4000); // nothing was dropped
  });

  it('reports every invalid parameter at once', async () => {
    const res = await list({ type: 'x', status: 'y', page: 0 }).expect(400);
    expect((res.body.error.details as { field: string }[]).map((d) => d.field).sort()).toEqual(['page', 'status', 'type']);
  });

  it('404 for an unknown customer, even with valid filters', async () => {
    expectFailure((await list({ type: 'BUY' }, 'C9999').expect(404)).body, 'NOT_FOUND');
  });

  it('uses the (account_id, trade_date) index for the main list query', async () => {
    await pool.query('analyze transactions');
    const { rows } = await pool.query(
      `explain select transaction_id from transactions where account_id = $1 order by trade_date desc limit 20`,
      [accountIds[0]],
    );
    expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('transactions_account_date_idx');
  });
});
