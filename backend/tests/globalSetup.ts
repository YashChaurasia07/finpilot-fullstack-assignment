import './setupEnv'; // must be first: src/config.ts reads process.env when it is first imported
import { Client } from 'pg';
import { pool } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/scripts/seed';
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL } from './testEnv';

/** Once per run: a brand-new test database, then migrations and the seed data. Nothing is left over from earlier runs. */
export default async function setup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to drop "${dbName}": only databases ending in _test may be recreated.`);
  const admin = new Client({ connectionString: ADMIN_DATABASE_URL });
  await admin.connect();
  await admin.query(`drop database if exists "${dbName}" with (force)`);
  await admin.query(`create database "${dbName}"`);
  await admin.end();

  await runMigrations();
  await seed();
  await pool.end();
}
