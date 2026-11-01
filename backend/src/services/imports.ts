/**
 * CSV import pipeline (used by the admin endpoint AND the seed script).
 *
 *  1. Parse the file and check its header          (400 for unreadable / empty / wrong-shape files)
 *  2. Validate every row, one reason code per bad row (no silent fixing: bad rows are rejected and recorded)
 *  3. In ONE database transaction, under a lock:
 *       - refuse a file that was already imported       (409)
 *       - reject rows with unknown references or that already exist (never overwrite)
 *       - insert the batch, the good rows and the rejections together, or nothing at all
 */
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db, type Tx } from '../db/client';
import { accounts, holdings, importBatches, importRejections, instruments, transactions, txStatus, txType } from '../db/schema';
import { chunks } from '../lib/chunks';
import { isRealDate, today as todayIso } from '../lib/dates';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export type Raw = Record<string, string | undefined>;
export type Fail = { code: string; detail: string };
type Checked<T> = { value: T } | Fail;
type TransactionInsert = typeof transactions.$inferInsert;
type HoldingInsert = typeof holdings.$inferInsert;

export interface Rejection {
  rowNumber: number;
  recordKey: string | null;
  code: string;
  detail: string;
}

export interface ImportResult {
  batchId: number;
  fileName: string;
  totalRows: number;
  importedRows: number;
  rejectedRows: number;
  truncated: boolean;
  rejections: Rejection[];
}

const MAX_ROWS = 50_000;
const MAX_RETURNED_REJECTIONS = 1_000;
const MIN_DATE = '2000-01-01';
const ID = /^[A-Za-z0-9_-]{1,12}$/;

/* ---------- row validation (pure; each failure returns a machine-readable code) ---------- */
const field = (raw: Raw, name: string) => (raw[name] ?? '').trim();
const fail = (raw: Raw, name: string, code: string, why?: string): Fail => ({
  code,
  detail: `${name} = ${field(raw, name) || '(empty)'}${why ? ` — ${why}` : ''}`,
});
const isFail = (value: unknown): value is Fail => typeof value === 'object' && value !== null && 'code' in value;
const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

/** A plain non-negative decimal that fits NUMERIC exactly. Never rounds or "fixes" a value. */
function decimal(raw: Raw, name: string, maxDecimals: number): string | Fail {
  const text = field(raw, name);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return fail(raw, name, 'INVALID_NUMBER', 'not a plain decimal number');
  if (text.startsWith('-')) return fail(raw, name, 'NEGATIVE_VALUE', 'must not be negative');
  if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${maxDecimals}})?$`).test(text)) {
    return fail(raw, name, 'INVALID_NUMBER', `at most 12 integer digits and ${maxDecimals} decimals`);
  }
  return text;
}

export const TRANSACTION_COLUMNS = [
  'transaction_id',
  'account_id',
  'instrument_id',
  'transaction_type',
  'trade_date',
  'quantity',
  'price',
  'amount',
  'status',
] as const;
export const HOLDING_COLUMNS = ['account_id', 'instrument_id', 'quantity', 'avg_cost', 'snapshot_date'] as const;

export function validateTransaction(raw: Raw, today: string): Checked<TransactionInsert> {
  for (const col of TRANSACTION_COLUMNS) if (!field(raw, col)) return fail(raw, col, 'MISSING_VALUE');
  for (const col of ['transaction_id', 'account_id', 'instrument_id']) {
    if (!ID.test(field(raw, col))) return fail(raw, col, 'INVALID_ID', 'use letters, digits, "-" or "_" (max 12)');
  }
  const type = field(raw, 'transaction_type');
  if (!isOneOf(txType.enumValues, type)) return fail(raw, 'transaction_type', 'INVALID_ENUM', `expected ${txType.enumValues.join(' | ')}`);
  const status = field(raw, 'status');
  if (!isOneOf(txStatus.enumValues, status)) return fail(raw, 'status', 'INVALID_ENUM', `expected ${txStatus.enumValues.join(' | ')}`);

  const tradeDate = field(raw, 'trade_date');
  if (!isRealDate(tradeDate) || tradeDate < MIN_DATE) return fail(raw, 'trade_date', 'INVALID_DATE', 'expected a real date (YYYY-MM-DD), 2000 or later');
  if (tradeDate > today) return fail(raw, 'trade_date', 'FUTURE_DATE', `later than today (${today})`);

  const quantity = decimal(raw, 'quantity', 4);
  if (isFail(quantity)) return quantity;
  const price = decimal(raw, 'price', 2);
  if (isFail(price)) return price;
  const amount = decimal(raw, 'amount', 2);
  if (isFail(amount)) return amount;
  if ((type === 'BUY' || type === 'SELL') && (Number(quantity) <= 0 || Number(price) <= 0)) {
    return fail(raw, 'quantity', 'INVALID_TRADE_VALUES', `${type} needs quantity > 0 and price > 0`);
  }
  return {
    value: {
      transactionId: field(raw, 'transaction_id'),
      accountId: field(raw, 'account_id'),
      instrumentId: field(raw, 'instrument_id'),
      transactionType: type,
      tradeDate,
      quantity,
      price,
      amount,
      status,
    },
  };
}

export function validateHolding(raw: Raw, today: string): Checked<HoldingInsert> {
  for (const col of HOLDING_COLUMNS) if (!field(raw, col)) return fail(raw, col, 'MISSING_VALUE');
  for (const col of ['account_id', 'instrument_id']) {
    if (!ID.test(field(raw, col))) return fail(raw, col, 'INVALID_ID', 'use letters, digits, "-" or "_" (max 12)');
  }
  const snapshotDate = field(raw, 'snapshot_date');
  if (!isRealDate(snapshotDate) || snapshotDate < MIN_DATE) return fail(raw, 'snapshot_date', 'INVALID_DATE', 'expected a real date (YYYY-MM-DD), 2000 or later');
  if (snapshotDate > today) return fail(raw, 'snapshot_date', 'FUTURE_DATE', `later than today (${today})`);

  const quantity = decimal(raw, 'quantity', 4);
  if (isFail(quantity)) return quantity;
  if (Number(quantity) <= 0) return fail(raw, 'quantity', 'INVALID_NUMBER', 'must be greater than 0');
  const avgCost = decimal(raw, 'avg_cost', 2);
  if (isFail(avgCost)) return avgCost;
  return {
    value: { accountId: field(raw, 'account_id'), instrumentId: field(raw, 'instrument_id'), snapshotDate, quantity, avgCost },
  };
}

/* ---------- CSV parsing ---------- */
function parseCsv(file: Buffer, required: readonly string[]): { rowNumber: number; raw: Raw }[] {
  if (file.length === 0) throw new AppError(400, 'EMPTY_FILE', 'The file is empty');
  if (file.includes(0)) {
    throw new AppError(400, 'INVALID_FILE', 'The file is not UTF-8 text (binary or UTF-16 content found). Export it as "CSV UTF-8".');
  }

  let headers: string[] = [];
  let records: { record: Raw; info: { lines: number } }[];
  try {
    records = parse(file, {
      columns: (header: string[]) => {
        headers = header.map((h) => h.trim().toLowerCase());
        if (new Set(headers).size !== headers.length) throw new Error('the header row has duplicate column names');
        return headers;
      },
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true, // short/long rows are judged row by row below, not as a whole-file failure
      info: true,
    });
  } catch (err) {
    throw new AppError(400, 'INVALID_CSV', `The CSV could not be read: ${(err as Error).message}`);
  }

  const missing = required.filter((col) => !headers.includes(col));
  if (missing.length) {
    const wrongDelimiter = headers.length === 1 && /[;\t|]/.test(headers[0]);
    throw new AppError(
      400,
      'MISSING_COLUMNS',
      `The header is missing required column(s): ${missing.join(', ')}${wrongDelimiter ? '. The file looks semicolon/tab-separated; use commas.' : ''}`,
      { missing, expected: required },
    );
  }
  if (records.length === 0) throw new AppError(400, 'NO_DATA_ROWS', 'The file has a header but no data rows');
  if (records.length > MAX_ROWS) throw new AppError(400, 'TOO_MANY_ROWS', `The file has ${records.length} rows; the limit is ${MAX_ROWS}`);
  return records.map(({ record, info }) => ({ rowNumber: info.lines, raw: record }));
}

/* ---------- generic import ---------- */
interface Spec<T extends object> {
  dataset: 'transactions' | 'holdings';
  lockKey: number; // pg advisory lock: one import per dataset at a time
  columns: readonly string[];
  validate: (raw: Raw, today: string) => Checked<T>;
  keyOf: (row: T) => string;
  rawKey: (raw: Raw) => string;
  duplicateCode: string;
  /** Checks that need the database: referenced rows must exist and the row must not already be loaded. */
  blockedRows: (tx: Tx, rows: T[]) => Promise<Map<T, Fail>>;
  insert: (tx: Tx, rows: T[], batchId: number) => Promise<void>;
}

async function found(tx: Tx, table: PgTable, column: PgColumn, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(ids)], 10_000)) {
    const rows = await tx.select({ id: column }).from(table).where(inArray(column, part));
    for (const row of rows) out.add(row.id as string);
  }
  return out;
}

const transactionSpec: Spec<TransactionInsert> = {
  dataset: 'transactions',
  lockKey: 7001,
  columns: TRANSACTION_COLUMNS,
  validate: validateTransaction,
  keyOf: (t) => t.transactionId,
  rawKey: (raw) => field(raw, 'transaction_id'),
  duplicateCode: 'DUPLICATE_ID',
  async blockedRows(tx, rows) {
    const [knownAccounts, knownInstruments, existing] = [
      await found(tx, accounts, accounts.accountId, rows.map((r) => r.accountId)),
      await found(tx, instruments, instruments.instrumentId, rows.map((r) => r.instrumentId)),
      await found(tx, transactions, transactions.transactionId, rows.map((r) => r.transactionId)),
    ];
    const out = new Map<TransactionInsert, Fail>();
    for (const r of rows) {
      if (!knownAccounts.has(r.accountId)) out.set(r, { code: 'UNKNOWN_ACCOUNT', detail: `account_id = ${r.accountId} does not exist` });
      else if (!knownInstruments.has(r.instrumentId)) out.set(r, { code: 'UNKNOWN_INSTRUMENT', detail: `instrument_id = ${r.instrumentId} does not exist` });
      else if (existing.has(r.transactionId)) out.set(r, { code: 'DUPLICATE_ID', detail: `transaction_id = ${r.transactionId} already exists (existing data is never overwritten)` });
    }
    return out;
  },
  async insert(tx, rows, batchId) {
    for (const part of chunks(rows, 1_000)) await tx.insert(transactions).values(part.map((r) => ({ ...r, importBatchId: batchId })));
  },
};

const holdingKey = (h: Pick<HoldingInsert, 'accountId' | 'instrumentId' | 'snapshotDate'>) => `${h.accountId}|${h.instrumentId}|${h.snapshotDate}`;

const holdingSpec: Spec<HoldingInsert> = {
  dataset: 'holdings',
  lockKey: 7002,
  columns: HOLDING_COLUMNS,
  validate: validateHolding,
  keyOf: holdingKey,
  rawKey: (raw) => `${field(raw, 'account_id')}/${field(raw, 'instrument_id')}`,
  duplicateCode: 'DUPLICATE_POSITION',
  async blockedRows(tx, rows) {
    const accountIds = rows.map((r) => r.accountId);
    const [knownAccounts, knownInstruments] = [
      await found(tx, accounts, accounts.accountId, accountIds),
      await found(tx, instruments, instruments.instrumentId, rows.map((r) => r.instrumentId)),
    ];
    const existing = new Set<string>();
    for (const part of chunks([...new Set(accountIds)], 10_000)) {
      const hits = await tx
        .select({ accountId: holdings.accountId, instrumentId: holdings.instrumentId, snapshotDate: holdings.snapshotDate })
        .from(holdings)
        .where(inArray(holdings.accountId, part));
      for (const h of hits) existing.add(holdingKey(h));
    }
    const out = new Map<HoldingInsert, Fail>();
    for (const r of rows) {
      if (!knownAccounts.has(r.accountId)) out.set(r, { code: 'UNKNOWN_ACCOUNT', detail: `account_id = ${r.accountId} does not exist` });
      else if (!knownInstruments.has(r.instrumentId)) out.set(r, { code: 'UNKNOWN_INSTRUMENT', detail: `instrument_id = ${r.instrumentId} does not exist` });
      else if (existing.has(holdingKey(r))) out.set(r, { code: 'DUPLICATE_POSITION', detail: `position ${r.accountId}/${r.instrumentId} on ${r.snapshotDate} already exists` });
    }
    return out;
  },
  async insert(tx, rows) {
    for (const part of chunks(rows, 1_000)) await tx.insert(holdings).values(part);
  },
};

interface ImportOptions {
  fileName: string;
  userId: number | null; // null = seed / system
  today?: string; // injectable so tests are deterministic
}

async function runImport<T extends object>(spec: Spec<T>, file: Buffer, opts: ImportOptions): Promise<ImportResult> {
  const today = opts.today ?? todayIso();
  const fileName = opts.fileName.slice(0, 255);
  const sha256 = createHash('sha256').update(file).digest('hex');
  const rows = parseCsv(file, spec.columns);

  // Step 2: validate rows and catch repeats inside the file (pure, no database needed).
  const signature = (raw: Raw) => spec.columns.map((c) => field(raw, c)).join('\u0001');
  const valid: { rowNumber: number; raw: Raw; value: T }[] = [];
  const rejected: (Rejection & { raw: Raw })[] = [];
  const firstSeen = new Map<string, { rowNumber: number; raw: Raw }>();
  const reject = (rowNumber: number, raw: Raw, why: Fail) =>
    rejected.push({ rowNumber, recordKey: spec.rawKey(raw).slice(0, 80) || null, code: why.code, detail: why.detail, raw });

  for (const { rowNumber, raw } of rows) {
    const checked = spec.validate(raw, today);
    if ('code' in checked) {
      reject(rowNumber, raw, checked);
      continue;
    }
    const key = spec.keyOf(checked.value);
    const first = firstSeen.get(key);
    if (first) {
      const same = signature(first.raw) === signature(raw);
      reject(rowNumber, raw, {
        code: spec.duplicateCode,
        detail: `repeats row ${first.rowNumber} (${same ? 'identical' : 'different values'}); the first occurrence is kept`,
      });
      continue;
    }
    firstSeen.set(key, { rowNumber, raw });
    valid.push({ rowNumber, raw, value: checked.value });
  }

  // Step 3: everything that touches the database happens atomically.
  const batchId = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${spec.lockKey})`);

    const [previous] = await tx
      .select({ id: importBatches.id, createdAt: importBatches.createdAt })
      .from(importBatches)
      .where(and(eq(importBatches.dataset, spec.dataset), eq(importBatches.fileSha256, sha256), gt(importBatches.importedRows, 0)))
      .limit(1);
    if (previous) {
      throw new AppError(409, 'ALREADY_IMPORTED', `This exact file was already imported as batch #${previous.id}`, {
        batchId: previous.id,
        importedAt: previous.createdAt,
      });
    }

    const blocked = await spec.blockedRows(tx, valid.map((v) => v.value));
    const toInsert: T[] = [];
    for (const v of valid) {
      const why = blocked.get(v.value);
      if (why) reject(v.rowNumber, v.raw, why);
      else toInsert.push(v.value);
    }
    rejected.sort((a, b) => a.rowNumber - b.rowNumber);

    const [batch] = await tx
      .insert(importBatches)
      .values({
        dataset: spec.dataset,
        fileName,
        fileSha256: sha256,
        totalRows: rows.length,
        importedRows: toInsert.length,
        rejectedRows: rejected.length,
        importedBy: opts.userId,
      })
      .returning({ id: importBatches.id });
    await spec.insert(tx, toInsert, batch.id);
    for (const part of chunks(rejected, 1_000)) {
      await tx.insert(importRejections).values(
        part.map((r) => ({ batchId: batch.id, rowNumber: r.rowNumber, recordKey: r.recordKey, code: r.code, detail: r.detail, rawRow: r.raw })),
      );
    }
    return batch.id;
  });

  const result: ImportResult = {
    batchId,
    fileName,
    totalRows: rows.length,
    importedRows: rows.length - rejected.length,
    rejectedRows: rejected.length,
    truncated: rejected.length > MAX_RETURNED_REJECTIONS,
    rejections: rejected.slice(0, MAX_RETURNED_REJECTIONS).map(({ raw: _raw, ...r }) => r),
  };
  logger.info(
    { dataset: spec.dataset, batchId, fileName, totalRows: result.totalRows, importedRows: result.importedRows, rejectedRows: result.rejectedRows, userId: opts.userId },
    'import finished',
  );
  return result;
}

export const importTransactions = (file: Buffer, opts: ImportOptions) => runImport(transactionSpec, file, opts);
export const importHoldings = (file: Buffer, opts: ImportOptions) => runImport(holdingSpec, file, opts);
