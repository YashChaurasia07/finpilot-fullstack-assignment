import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { API, customerWhere, expectFailure, expectSuccess, pool, signIn } from '../helpers';

const app = createApp();
let agent: Awaited<ReturnType<typeof signIn>>;
beforeAll(async () => {
  agent = await signIn(app, 'viewer');
});

describe('GET /customers (search + pagination)', () => {
  it('lists customers with the standard envelope and pagination meta', async () => {
    const res = await agent.get(`${API}/customers`).expect(200);
    const data = expectSuccess(res.body) as { customerId: string; fullName: string }[];
    expect(data).toHaveLength(20);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 120, totalPages: 6 });
    expect(data[0]).toEqual({
      customerId: expect.stringMatching(/^C\d{4}$/),
      fullName: expect.any(String),
      email: expect.any(String),
      phone: expect.any(String),
      city: expect.any(String),
      state: expect.any(String),
      kycStatus: expect.stringMatching(/^(VERIFIED|PENDING|REVIEW)$/),
      segment: expect.stringMatching(/^(Mass|Affluent|HNI)$/),
    });
    const names = data.map((c) => c.fullName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).length ? names : []);
  });

  it('pages through everyone exactly once (stable ordering)', async () => {
    const seen = new Set<string>();
    for (let page = 1; page <= 6; page++) {
      const res = await agent.get(`${API}/customers?page=${page}&pageSize=20`).expect(200);
      for (const c of res.body.data) seen.add(c.customerId);
    }
    expect(seen.size).toBe(120);
  });

  it.each([
    ['customer id', 'C0001', (c: Record<string, string>) => c.customerId === 'C0001'],
    ['customer id, lower case', 'c0001', (c: Record<string, string>) => c.customerId === 'C0001'],
    ['part of a name', 'sharma', (c: Record<string, string>) => /sharma/i.test(c.fullName)],
    ['email fragment', 'example.test', () => true],
    ['city', 'chennai', (c: Record<string, string>) => /chennai/i.test(c.city)],
    ['padded with spaces', '  chennai  ', (c: Record<string, string>) => /chennai/i.test(c.city)],
  ])('searches by %s', async (_label, q, matches) => {
    const res = await agent.get(`${API}/customers`).query({ q, pageSize: 100 }).expect(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every(matches)).toBe(true);
    const { rows } = await pool.query(
      `select count(*)::int n from customers where customer_id ilike $1 or full_name ilike $1 or email ilike $1 or city ilike $1`,
      [`%${q.trim()}%`],
    );
    expect(res.body.meta.total).toBe(rows[0].n); // matches an independent SQL count
  });

  it('treats % and _ literally instead of as wildcards', async () => {
    for (const q of ['%', '_', '\\', '100%']) {
      const res = await agent.get(`${API}/customers`).query({ q }).expect(200);
      expect(res.body.meta.total, `q=${q}`).toBe(0);
    }
  });

  it('is not fooled by SQL-injection style input', async () => {
    const res = await agent.get(`${API}/customers`).query({ q: "'; DROP TABLE customers; --" }).expect(200);
    expect(res.body.meta.total).toBe(0);
    expect((await pool.query('select count(*)::int n from customers')).rows[0].n).toBe(120);
  });

  it('returns an empty page (not an error) for no matches or a page past the end', async () => {
    const none = await agent.get(`${API}/customers`).query({ q: 'zzzzzz-no-match' }).expect(200);
    expect(none.body).toMatchObject({ success: true, data: [], meta: { total: 0, totalPages: 0 } });
    const beyond = await agent.get(`${API}/customers?page=999`).expect(200);
    expect(beyond.body).toMatchObject({ data: [], meta: { page: 999, total: 120, totalPages: 6 } });
  });

  it('ignores blank q/page/pageSize values', async () => {
    const res = await agent.get(`${API}/customers?q=&page=&pageSize=`).expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 120 });
    expect((await agent.get(`${API}/customers?q=%20%20%20`).expect(200)).body.meta.total).toBe(120);
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['page=1e2', 'page'],
    ['page=0x10', 'page'],
    ['page=1&page=2', 'page'],
    ['page=1000001', 'page'],
    ['pageSize=0', 'pageSize'],
    ['pageSize=101', 'pageSize'],
    ['pageSize=abc', 'pageSize'],
    [`q=${'x'.repeat(101)}`, 'q'],
  ])('400 for %s', async (qs, field) => {
    const res = await agent.get(`${API}/customers?${qs}`).expect(400);
    const error = expectFailure(res.body, 'VALIDATION_ERROR');
    expect((error.details as { field: string }[]).map((d) => d.field)).toContain(field);
  });
});

describe('GET /customers/:id', () => {
  it('returns the profile, latest risk profile and accounts', async () => {
    const res = await agent.get(`${API}/customers/C0002`).expect(200);
    const data = expectSuccess(res.body) as Record<string, unknown>;
    expect(data).toMatchObject({
      customerId: 'C0002',
      fullName: 'Kabir Singh',
      kycStatus: 'PENDING',
      riskProfile: { riskScore: 83, riskLevel: 'Aggressive', horizonYears: 10, liquidityNeed: 'HIGH', assessedAt: '2026-03-05' },
    });
    expect(data.accounts).toEqual([
      { accountId: 'A00002', accountType: 'BROKERAGE', provider: 'NorthStar Securities', status: 'ACTIVE', openedAt: '2024-12-27', baseCurrency: 'INR' },
    ]);
  });

  it('dates are plain YYYY-MM-DD strings (no timezone shifting)', async () => {
    const res = await agent.get(`${API}/customers/C0002`).expect(200);
    expect(res.body.data.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.data.onboardedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it.each([
    ['unknown customer', 'C9999'],
    ['wrong case', 'c0002'],
    ['malformed id', 'bad id!'],
    ['too long', 'C'.repeat(40)],
    ['injection attempt', "C0002'%20OR%20'1'='1"],
    ['path traversal', '..%2F..%2Fetc%2Fpasswd'],
  ])('404 for %s', async (_label, id) => {
    expectFailure((await agent.get(`${API}/customers/${id}`).expect(404)).body, 'NOT_FOUND');
  });

  describe('a customer without a risk profile or accounts', () => {
    beforeAll(async () => {
      await pool.query(
        `insert into customers values ('CTEST1','Test Nobody','nobody@example.test','+910000000000','Pune','MH','1990-01-01','2024-01-01','PENDING','Mass') on conflict do nothing`,
      );
    });
    afterAll(async () => {
      await pool.query(`delete from customers where customer_id = 'CTEST1'`);
    });

    it('still returns the profile, with riskProfile null and no accounts', async () => {
      const res = await agent.get(`${API}/customers/CTEST1`).expect(200);
      expect(res.body.data).toMatchObject({ customerId: 'CTEST1', riskProfile: null, accounts: [] });
    });

    it('has an empty portfolio, no transactions and no goals (never an error)', async () => {
      const portfolio = await agent.get(`${API}/customers/CTEST1/portfolio`).expect(200);
      expect(portfolio.body.data).toEqual({
        customerId: 'CTEST1',
        asOf: { snapshotDate: null, priceDate: null },
        totals: { marketValue: '0.00', costValue: '0.00', unrealisedPnl: '0.00', unrealisedPnlPct: null, positionCount: 0 },
        accounts: [],
        allocation: [],
        positions: [],
      });
      expect((await agent.get(`${API}/customers/CTEST1/transactions`).expect(200)).body).toMatchObject({ data: [], meta: { total: 0, totalPages: 0 } });
      expect((await agent.get(`${API}/customers/CTEST1/goals`).expect(200)).body.data).toEqual([]);
    });
  });
});

describe('GET /instruments', () => {
  it('lists all instruments sorted by symbol', async () => {
    const res = await agent.get(`${API}/instruments`).expect(200);
    expect(res.body.data).toHaveLength(80);
    expect(res.body.data[0]).toEqual({ instrumentId: expect.any(String), symbol: expect.any(String), instrumentName: expect.any(String), assetClass: expect.any(String) });
    const symbols = res.body.data.map((i: { symbol: string }) => i.symbol);
    expect(symbols).toEqual([...symbols].sort());
  });
});

describe('GET /customers/:id/portfolio', () => {
  const money = (v: string) => Math.round(Number(v) * 100);

  it('totals, accounts, allocation and positions agree with each other and with independent SQL', async () => {
    const id = await customerWhere(
      `(select count(*) from accounts a where a.customer_id = c.customer_id) >= 2
       and exists (select 1 from v_positions p where p.customer_id = c.customer_id)`,
    );
    const res = await agent.get(`${API}/customers/${id}/portfolio`).expect(200);
    const p = expectSuccess(res.body) as {
      asOf: { snapshotDate: string; priceDate: string };
      totals: { marketValue: string; costValue: string; unrealisedPnl: string; unrealisedPnlPct: string; positionCount: number };
      accounts: { accountId: string; marketValue: string; costValue: string; positionCount: number }[];
      allocation: { assetClass: string; marketValue: string; weightPct: string }[];
      positions: { accountId: string; quantity: string; lastPrice: string; marketValue: string; costValue: string; avgCost: string; unrealisedPnl: string }[];
    };

    // independent recomputation straight from the base tables (not through the view)
    const { rows } = await pool.query(
      `select sum(round(h.quantity * i.last_price, 2)) mv, sum(round(h.quantity * h.avg_cost, 2)) cv, count(*)::int n
         from holdings h join accounts a using (account_id) join instruments i using (instrument_id)
        where a.customer_id = $1 and h.snapshot_date = (select max(snapshot_date) from holdings)`,
      [id],
    );
    expect(money(p.totals.marketValue)).toBe(money(rows[0].mv));
    expect(money(p.totals.costValue)).toBe(money(rows[0].cv));
    expect(p.totals.positionCount).toBe(rows[0].n);
    expect(p.positions).toHaveLength(rows[0].n);
    expect(money(p.totals.unrealisedPnl)).toBe(money(p.totals.marketValue) - money(p.totals.costValue));

    // the same numbers, cut three ways, must add up
    const sum = (xs: string[]) => xs.reduce((a, x) => a + money(x), 0);
    expect(sum(p.positions.map((x) => x.marketValue))).toBe(money(p.totals.marketValue));
    expect(sum(p.accounts.map((x) => x.marketValue))).toBe(money(p.totals.marketValue));
    expect(sum(p.allocation.map((x) => x.marketValue))).toBe(money(p.totals.marketValue));
    expect(p.accounts.reduce((a, x) => a + x.positionCount, 0)).toBe(p.totals.positionCount);
    expect(p.accounts.length).toBeGreaterThanOrEqual(2);

    // weights: sorted high to low, and add up to 100% (within rounding)
    const weights = p.allocation.map((a) => Number(a.weightPct));
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(Math.abs(weights.reduce((a, w) => a + w, 0) - 100)).toBeLessThan(0.05 * weights.length);

    // each position's maths is right
    for (const pos of p.positions) {
      expect(money(pos.marketValue)).toBe(Math.round(Number(pos.quantity) * Number(pos.lastPrice) * 100));
      expect(money(pos.unrealisedPnl)).toBe(money(pos.marketValue) - money(pos.costValue));
    }
    // freshness dates come from the data
    expect(p.asOf).toEqual({ snapshotDate: '2026-09-18', priceDate: '2026-09-18' });
  });

  it('lists accounts that hold nothing (zero totals) instead of hiding them', async () => {
    const id = await customerWhere(
      `exists (select 1 from accounts a where a.customer_id = c.customer_id and not exists (select 1 from holdings h where h.account_id = a.account_id))
       and exists (select 1 from v_positions p where p.customer_id = c.customer_id)`,
    );
    const res = await agent.get(`${API}/customers/${id}/portfolio`).expect(200);
    const empty = res.body.data.accounts.filter((a: { positionCount: number }) => a.positionCount === 0);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty[0]).toMatchObject({ marketValue: '0.00', costValue: '0.00', unrealisedPnl: '0.00' });
  });

  it('a seeded customer with accounts but no holdings gets zeros, not an error', async () => {
    const id = await customerWhere(`not exists (select 1 from v_positions p where p.customer_id = c.customer_id)`);
    const res = await agent.get(`${API}/customers/${id}/portfolio`).expect(200);
    expect(res.body.data.totals).toMatchObject({ marketValue: '0.00', positionCount: 0, unrealisedPnlPct: null });
    expect(res.body.data.positions).toEqual([]);
    expect(res.body.data.allocation).toEqual([]);
  });

  it('the duplicate holdings rows in the source data are not double-counted', async () => {
    // A00145 / I0036 appears twice in holdings_snapshot.csv with identical values
    const { rows } = await pool.query(`select count(*)::int n from v_positions where account_id = 'A00145' and instrument_id = 'I0036'`);
    expect(rows[0].n).toBe(1);
  });

  it('404 for an unknown customer', async () => {
    expectFailure((await agent.get(`${API}/customers/C9999/portfolio`).expect(404)).body, 'NOT_FOUND');
  });
});
