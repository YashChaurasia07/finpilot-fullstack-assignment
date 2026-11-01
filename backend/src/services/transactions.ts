import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { accounts, instruments, transactions, txStatus, txType } from '../db/schema';
import { requireCustomer } from './customers';

export interface TransactionQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  accountId?: string;
  instrumentId?: string;
  type?: (typeof txType.enumValues)[number];
  status?: (typeof txStatus.enumValues)[number];
  sortBy: 'tradeDate' | 'amount';
  order: 'asc' | 'desc';
}

/** Filtering, sorting and paging all happen in SQL; only one page of rows ever leaves the database. */
export async function listTransactions(customerId: string, q: TransactionQuery) {
  await requireCustomer(customerId);

  const where = and(
    eq(accounts.customerId, customerId), // scopes the list to this customer, whatever accountId is sent
    q.from ? gte(transactions.tradeDate, q.from) : undefined,
    q.to ? lte(transactions.tradeDate, q.to) : undefined,
    q.accountId ? eq(transactions.accountId, q.accountId) : undefined,
    q.instrumentId ? eq(transactions.instrumentId, q.instrumentId) : undefined,
    q.type ? eq(transactions.transactionType, q.type) : undefined,
    q.status ? eq(transactions.status, q.status) : undefined,
  );
  const direction = q.order === 'asc' ? asc : desc;
  const sortColumn = q.sortBy === 'amount' ? transactions.amount : transactions.tradeDate;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        transactionId: transactions.transactionId,
        accountId: transactions.accountId,
        instrumentId: transactions.instrumentId,
        symbol: instruments.symbol,
        instrumentName: instruments.instrumentName,
        transactionType: transactions.transactionType,
        tradeDate: transactions.tradeDate,
        quantity: transactions.quantity,
        price: transactions.price,
        amount: transactions.amount,
        status: transactions.status,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.accountId, transactions.accountId))
      .innerJoin(instruments, eq(instruments.instrumentId, transactions.instrumentId))
      .where(where)
      // transaction_id as a tie-breaker keeps page boundaries stable when many rows share a date or amount
      .orderBy(direction(sortColumn), direction(transactions.transactionId))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({ total: count() })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.accountId, transactions.accountId))
      .where(where),
  ]);
  return { rows, total };
}
