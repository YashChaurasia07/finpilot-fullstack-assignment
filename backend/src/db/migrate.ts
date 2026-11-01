import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { logger } from '../lib/logger';
import { db, pool } from './client';

/** Applies pending SQL migrations from /drizzle. They run in one transaction: all apply or none do. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      logger.info('database migrations applied');
      return pool.end();
    })
    .catch((err) => {
      logger.error({ err }, 'database migration failed');
      process.exit(1);
    });
}
