import { desc, eq, sql, type AnyColumn } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, vPositions as v } from '../db/schema';
import { requireCustomer } from './customers';

// Exact decimal sums, always with 2 decimals ("0.00" when there are no rows).
const total = (column: AnyColumn) => sql<string>`coalesce(sum(${column}), 0)::numeric(18,2)`;

/**
 * Four small queries over the v_positions view, run in parallel (a constant number, so no N+1):
 * totals, per-account totals, allocation by asset class, and the positions themselves.
 * All aggregation happens in PostgreSQL; the browser only renders.
 */
export async function getPortfolio(customerId: string) {
  await requireCustomer(customerId);

  const [[totals], accountRows, allocation, positions] = await Promise.all([
    db
      .select({
        marketValue: total(v.marketValue),
        costValue: total(v.costValue),
        unrealisedPnl: total(v.unrealisedPnl),
        unrealisedPnlPct: sql<string | null>`round(sum(${v.unrealisedPnl}) / nullif(sum(${v.costValue}), 0) * 100, 2)`,
        positionCount: sql<number>`count(*)::int`,
        snapshotDate: sql<string | null>`max(${v.snapshotDate})`,
        // The OLDEST price date among the positions: the honest answer to "how fresh are these numbers?"
        priceDate: sql<string | null>`min(${v.priceAsOf})`,
      })
      .from(v)
      .where(eq(v.customerId, customerId)),

    // LEFT JOIN so accounts without positions still appear (with zero totals).
    db
      .select({
        accountId: accounts.accountId,
        accountType: accounts.accountType,
        provider: accounts.provider,
        status: accounts.status,
        openedAt: accounts.openedAt,
        marketValue: total(v.marketValue),
        costValue: total(v.costValue),
        unrealisedPnl: total(v.unrealisedPnl),
        positionCount: sql<number>`count(${v.instrumentId})::int`,
      })
      .from(accounts)
      .leftJoin(v, eq(v.accountId, accounts.accountId))
      .where(eq(accounts.customerId, customerId))
      .groupBy(accounts.accountId)
      .orderBy(accounts.accountId),

    // Window function over the aggregate: each class's share of the customer's total.
    db
      .select({
        assetClass: v.assetClass,
        marketValue: total(v.marketValue),
        weightPct: sql<string>`round(100 * sum(${v.marketValue}) / sum(sum(${v.marketValue})) over (), 2)`,
      })
      .from(v)
      .where(eq(v.customerId, customerId))
      .groupBy(v.assetClass)
      .orderBy(desc(sql`sum(${v.marketValue})`), v.assetClass),

    db
      .select({
        accountId: v.accountId,
        instrumentId: v.instrumentId,
        symbol: v.symbol,
        instrumentName: v.instrumentName,
        assetClass: v.assetClass,
        quantity: v.quantity,
        avgCost: v.avgCost,
        lastPrice: v.lastPrice,
        marketValue: v.marketValue,
        costValue: v.costValue,
        unrealisedPnl: v.unrealisedPnl,
        unrealisedPnlPct: v.unrealisedPnlPct,
      })
      .from(v)
      .where(eq(v.customerId, customerId))
      .orderBy(desc(v.marketValue), v.symbol, v.accountId),
  ]);

  const { snapshotDate, priceDate, ...summary } = totals;
  return {
    customerId,
    asOf: { snapshotDate, priceDate },
    totals: summary,
    accounts: accountRows,
    allocation,
    positions,
  };
}
