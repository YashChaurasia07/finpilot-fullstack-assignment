/**
 * Single source of truth for the database. `npm run db:generate` turns this file into SQL migrations.
 * Natural keys from the supplied CSVs (C0001, A00001, ...) are the primary keys, so imports are trivial
 * and URLs stay readable. Money and quantities are NUMERIC (exact), never floating point.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/* ---------- column helpers ---------- */
const key = (name: string) => varchar(name, { length: 12 });
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
const quantity = (name: string) => numeric(name, { precision: 18, scale: 4 });
const day = (name: string) => date(name, { mode: 'string' }); // 'YYYY-MM-DD' strings, no timezone surprises
const stamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/* ---------- enums (the same value lists feed Zod validation) ---------- */
export const kycStatus = pgEnum('kyc_status', ['VERIFIED', 'PENDING', 'REVIEW']);
export const segment = pgEnum('segment', ['Mass', 'Affluent', 'HNI']);
export const accountType = pgEnum('account_type', ['BROKERAGE', 'MUTUAL_FUND', 'RETIREMENT']);
export const accountStatus = pgEnum('account_status', ['ACTIVE', 'DORMANT', 'CLOSED']);
export const assetClass = pgEnum('asset_class', ['EQUITY', 'ETF', 'MUTUAL_FUND', 'BOND', 'REIT', 'GSEC']);
export const exchange = pgEnum('exchange', ['NSE', 'BSE', 'OTC']);
export const riskBand = pgEnum('risk_band', ['LOW', 'MEDIUM', 'HIGH']);
export const txType = pgEnum('transaction_type', ['BUY', 'SELL', 'DIVIDEND', 'FEE']);
export const txStatus = pgEnum('transaction_status', ['SETTLED', 'PENDING', 'REVERSED']);
export const goalType = pgEnum('goal_type', ['RETIREMENT', 'EDUCATION', 'HOME_PURCHASE', 'EMERGENCY_FUND', 'TRAVEL', 'WEALTH_CREATION']);
export const priority = pgEnum('priority', ['LOW', 'MEDIUM', 'HIGH']); // declaration order = sort order
export const riskLevel = pgEnum('risk_level', ['Conservative', 'Moderate', 'Growth', 'Aggressive']);
export const liquidityNeed = pgEnum('liquidity_need', ['LOW', 'MEDIUM', 'HIGH']);
export const userRole = pgEnum('user_role', ['VIEWER', 'ADMIN']);
export const importDataset = pgEnum('import_dataset', ['transactions', 'holdings']);

/* ---------- customers and their risk profile ---------- */
export const customers = pgTable('customers', {
  customerId: key('customer_id').primaryKey(),
  fullName: varchar('full_name', { length: 120 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(),
  phone: varchar('phone', { length: 20 }).notNull(),
  city: varchar('city', { length: 80 }).notNull(),
  state: char('state', { length: 2 }).notNull(),
  dateOfBirth: day('date_of_birth').notNull(),
  onboardedAt: day('onboarded_at').notNull(),
  kycStatus: kycStatus('kyc_status').notNull(),
  segment: segment('segment').notNull(),
});

// One latest profile per customer. (History would make the key (customer_id, assessed_at).)
export const riskProfiles = pgTable(
  'risk_profiles',
  {
    customerId: key('customer_id')
      .primaryKey()
      .references(() => customers.customerId),
    riskScore: smallint('risk_score').notNull(),
    riskLevel: riskLevel('risk_level').notNull(),
    assessedAt: day('assessed_at').notNull(),
    horizonYears: smallint('horizon_years').notNull(),
    liquidityNeed: liquidityNeed('liquidity_need').notNull(),
  },
  (t) => [
    check('risk_profiles_score_range', sql`${t.riskScore} between 0 and 100`),
    check('risk_profiles_horizon_positive', sql`${t.horizonYears} > 0`),
  ],
);

/* ---------- accounts and instruments ---------- */
export const accounts = pgTable(
  'accounts',
  {
    accountId: key('account_id').primaryKey(),
    customerId: key('customer_id')
      .notNull()
      .references(() => customers.customerId),
    accountType: accountType('account_type').notNull(),
    provider: varchar('provider', { length: 80 }).notNull(),
    openedAt: day('opened_at').notNull(),
    status: accountStatus('status').notNull(),
    baseCurrency: char('base_currency', { length: 3 }).notNull(),
  },
  (t) => [index('accounts_customer_idx').on(t.customerId)],
);

export const instruments = pgTable(
  'instruments',
  {
    instrumentId: key('instrument_id').primaryKey(),
    symbol: varchar('symbol', { length: 20 }).notNull().unique(),
    instrumentName: varchar('instrument_name', { length: 120 }).notNull(),
    assetClass: assetClass('asset_class').notNull(),
    sector: varchar('sector', { length: 60 }), // only equities have one
    exchange: exchange('exchange').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    lastPrice: money('last_price').notNull(),
    priceAsOf: day('price_as_of').notNull(),
    riskBand: riskBand('risk_band').notNull(),
  },
  (t) => [check('instruments_price_positive', sql`${t.lastPrice} > 0`)],
);

/* ---------- import bookkeeping ---------- */
export const users = pgTable(
  'users',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: varchar('email', { length: 254 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 100 }).notNull(),
    fullName: varchar('full_name', { length: 120 }).notNull(),
    role: userRole('role').notNull().default('VIEWER'),
    createdAt: stamp('created_at').notNull().defaultNow(),
  },
  (t) => [check('users_email_lowercase', sql`${t.email} = lower(${t.email})`)],
);

export const importBatches = pgTable(
  'import_batches',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    dataset: importDataset('dataset').notNull(),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileSha256: char('file_sha256', { length: 64 }).notNull(),
    totalRows: integer('total_rows').notNull(),
    importedRows: integer('imported_rows').notNull(),
    rejectedRows: integer('rejected_rows').notNull(),
    importedBy: integer('imported_by').references(() => users.id), // null = seed/system
    createdAt: stamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // The same file cannot be loaded twice. A file that imported nothing may be retried.
    uniqueIndex('import_batches_file_uq')
      .on(t.dataset, t.fileSha256)
      .where(sql`${t.importedRows} > 0`),
    check('import_batches_counts', sql`${t.importedRows} + ${t.rejectedRows} = ${t.totalRows}`),
  ],
);

export const importRejections = pgTable(
  'import_rejections',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    batchId: integer('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    rowNumber: integer('row_number').notNull(), // spreadsheet row, header = 1
    recordKey: varchar('record_key', { length: 80 }),
    code: varchar('code', { length: 40 }).notNull(),
    detail: text('detail').notNull(),
    rawRow: jsonb('raw_row').notNull(),
  },
  (t) => [index('import_rejections_batch_idx').on(t.batchId)],
);

/* ---------- holdings snapshot and transactions ledger ---------- */
export const holdings = pgTable(
  'holdings',
  {
    accountId: key('account_id')
      .notNull()
      .references(() => accounts.accountId),
    instrumentId: key('instrument_id')
      .notNull()
      .references(() => instruments.instrumentId),
    snapshotDate: day('snapshot_date').notNull(),
    quantity: quantity('quantity').notNull(),
    avgCost: money('avg_cost').notNull(),
  },
  (t) => [
    // The composite key is what stops duplicate position rows from double-counting AUM.
    primaryKey({ columns: [t.accountId, t.instrumentId, t.snapshotDate] }),
    check('holdings_quantity_positive', sql`${t.quantity} > 0`),
    check('holdings_avg_cost_non_negative', sql`${t.avgCost} >= 0`),
    index('holdings_instrument_idx').on(t.instrumentId),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    transactionId: key('transaction_id').primaryKey(),
    accountId: key('account_id')
      .notNull()
      .references(() => accounts.accountId),
    instrumentId: key('instrument_id')
      .notNull()
      .references(() => instruments.instrumentId),
    transactionType: txType('transaction_type').notNull(),
    tradeDate: day('trade_date').notNull(),
    quantity: quantity('quantity').notNull(),
    price: money('price').notNull(),
    amount: money('amount').notNull(),
    status: txStatus('status').notNull(),
    importBatchId: integer('import_batch_id').references(() => importBatches.id), // lineage: which load brought it in
  },
  (t) => [
    check('transactions_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('transactions_price_non_negative', sql`${t.price} >= 0`),
    check('transactions_amount_non_negative', sql`${t.amount} >= 0`),
    // Serves the main list query (one customer's accounts, newest first). NULLS FIRST is what ORDER BY ... DESC means.
    index('transactions_account_date_idx').on(t.accountId, t.tradeDate.desc().nullsFirst()),
    index('transactions_instrument_idx').on(t.instrumentId),
  ],
);

/* ---------- goals ---------- */
// Keeps the supplied G00001 style for goals created through the API.
export const goalIdSeq = pgSequence('goal_id_seq', { startWith: 1 });

export const goals = pgTable(
  'goals',
  {
    goalId: key('goal_id')
      .primaryKey()
      .default(sql`'G' || lpad(nextval('goal_id_seq')::text, 5, '0')`),
    customerId: key('customer_id')
      .notNull()
      .references(() => customers.customerId),
    goalType: goalType('goal_type').notNull(),
    goalName: varchar('goal_name', { length: 120 }).notNull(),
    targetAmount: money('target_amount').notNull(),
    currentFundedAmount: money('current_funded_amount').notNull(),
    targetDate: day('target_date').notNull(),
    priority: priority('priority').notNull(),
    createdAt: stamp('created_at').notNull().defaultNow(),
    updatedAt: stamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('goals_target_positive', sql`${t.targetAmount} > 0`),
    check('goals_funded_non_negative', sql`${t.currentFundedAmount} >= 0`),
    index('goals_customer_idx').on(t.customerId),
  ],
);

/* ---------- view (created by hand in drizzle/0001_positions_view.sql; declared here for typed queries) ---------- */
export const vPositions = pgView('v_positions', {
  customerId: key('customer_id').notNull(),
  accountId: key('account_id').notNull(),
  accountType: accountType('account_type').notNull(),
  instrumentId: key('instrument_id').notNull(),
  symbol: varchar('symbol', { length: 20 }).notNull(),
  instrumentName: varchar('instrument_name', { length: 120 }).notNull(),
  assetClass: assetClass('asset_class').notNull(),
  sector: varchar('sector', { length: 60 }),
  quantity: quantity('quantity').notNull(),
  avgCost: money('avg_cost').notNull(),
  lastPrice: money('last_price').notNull(),
  marketValue: money('market_value').notNull(),
  costValue: money('cost_value').notNull(),
  unrealisedPnl: money('unrealised_pnl').notNull(),
  unrealisedPnlPct: numeric('unrealised_pnl_pct'),
  snapshotDate: day('snapshot_date').notNull(),
  priceAsOf: day('price_as_of').notNull(),
}).existing();
