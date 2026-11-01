/**
 * Loads the supplied CSVs plus two demo staff users. Safe to run repeatedly:
 *  - master tables use ON CONFLICT DO NOTHING
 *  - holdings and transactions go through the same importer as the admin upload, so the deliberate
 *    anomalies in the data are rejected and recorded in import_rejections (the raw CSVs are never edited)
 *    and a file that was already loaded is skipped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { config } from '../config';
import { db, pool } from '../db/client';
import { accounts, customers, goals, instruments, riskProfiles, users } from '../db/schema';
import { chunks } from '../lib/chunks';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { importHoldings, importTransactions, type ImportResult } from '../services/imports';

const read = (file: string) => readFileSync(path.join(config.DATA_DIR, file));

/** customer_id -> customerId, and blank cells -> NULL (e.g. the sector of a bond). */
const toRow = (row: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value === '' ? null : value]),
  );

// Parents before children so foreign keys are always satisfied.
const MASTER_FILES: [file: string, table: PgTable][] = [
  ['customers.csv', customers],
  ['risk_profiles.csv', riskProfiles],
  ['accounts.csv', accounts],
  ['instruments.csv', instruments],
  ['goals.csv', goals],
];

async function seedUsers() {
  const demo = [
    { email: config.SEED_ADMIN_EMAIL, password: config.SEED_ADMIN_PASSWORD, role: 'ADMIN' as const, fullName: 'Demo Admin' },
    { email: config.SEED_VIEWER_EMAIL, password: config.SEED_VIEWER_PASSWORD, role: 'VIEWER' as const, fullName: 'Demo Viewer' },
  ];
  for (const user of demo) {
    if (!user.password || Buffer.byteLength(user.password) < 8 || Buffer.byteLength(user.password) > 72) {
      throw new Error(`Set a 8-72 character seed password for ${user.email} (SEED_ADMIN_PASSWORD / SEED_VIEWER_PASSWORD)`);
    }
    await db
      .insert(users)
      .values({ email: user.email.toLowerCase(), passwordHash: await bcrypt.hash(user.password, 10), fullName: user.fullName, role: user.role })
      .onConflictDoNothing();
  }
  logger.info('demo users ready');
}

async function seedMasterData() {
  await db.transaction(async (tx) => {
    for (const [file, table] of MASTER_FILES) {
      const rows = parse(read(file), { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
      for (const part of chunks(rows.map(toRow), 1_000)) await tx.insert(table).values(part as never).onConflictDoNothing();
      logger.info({ file, rows: rows.length }, 'master data loaded');
    }
    // Goals created through the API continue after the highest imported ID (G00177 -> G00178).
    await tx.execute(
      sql`select setval('goal_id_seq', coalesce((select max(substr(goal_id, 2)::int) from goals where goal_id ~ '^G[0-9]+$'), 0) + 1, false)`,
    );
  });
}

async function seedImport(label: string, run: () => Promise<ImportResult>) {
  try {
    const result = await run();
    logger.info(`${label}: ${result.importedRows} imported, ${result.rejectedRows} rejected (batch #${result.batchId})`);
    for (const r of result.rejections) logger.warn(`${label}: row ${r.rowNumber} rejected ${r.code} — ${r.detail}`);
  } catch (err) {
    if (err instanceof AppError && err.code === 'ALREADY_IMPORTED') return void logger.info(`${label}: already imported, skipping`);
    throw err;
  }
}

export async function seed(): Promise<void> {
  await seedUsers();
  await seedMasterData();
  await seedImport('holdings', () => importHoldings(read('holdings_snapshot.csv'), { fileName: 'holdings_snapshot.csv', userId: null }));
  await seedImport('transactions', () => importTransactions(read('transactions.csv'), { fileName: 'transactions.csv', userId: null }));
}

if (require.main === module) {
  if (config.NODE_ENV === 'production' && !config.SEED_ON_START) {
    logger.info('seed skipped (set SEED_ON_START=true to load demo data in production mode)');
    process.exit(0);
  }
  seed()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'seed failed');
      process.exit(1);
    });
}
