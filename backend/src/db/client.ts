import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, types } from 'pg';
import { config } from '../config';
import { logger } from '../lib/logger';

// Return DATE columns as plain 'YYYY-MM-DD' strings (pg would otherwise build a Date at local midnight).
types.setTypeParser(types.builtins.DATE, (value) => value);

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  application_name: 'finpilot-api',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000, // fail fast instead of hanging when the DB is unreachable
  statement_timeout: 10_000, // no query may run longer than 10 s
});

// Without this handler an error on an idle connection (e.g. the DB restarting) would crash the process.
pool.on('error', (err) => logger.error({ err }, 'unexpected error on an idle database connection'));

export const db = drizzle(pool);
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
