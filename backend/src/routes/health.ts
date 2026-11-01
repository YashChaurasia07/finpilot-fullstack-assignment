import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { pool } from '../db/client';
import { AppError } from '../lib/errors';
import { ok } from '../lib/respond';

const DB_TIMEOUT_MS = 2_000;
// package.json sits next to /src (and /dist), like openapi.yaml.
const { version } = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };

async function checkDatabase(): Promise<number> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('database check timed out')), DB_TIMEOUT_MS);
  });
  try {
    await Promise.race([pool.query('select 1'), timeout]);
    return Date.now() - started;
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes = Router();

/** Liveness + readiness in one: 200 when the API can reach PostgreSQL, 503 (same envelope) when it cannot. No secrets. */
healthRoutes.get('/', async (req, res) => {
  try {
    const latencyMs = await checkDatabase();
    ok(res, { status: 'ok', version, uptimeSeconds: Math.round(process.uptime()), checks: { database: { status: 'up', latencyMs } } });
  } catch (err) {
    req.log.error({ err }, 'health check: database unreachable');
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'The API is running but the database is not reachable', {
      checks: { database: { status: 'down' } },
    });
  }
});
