import path from 'node:path';
import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) => z.coerce.number().int().min(min).max(max).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(8000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'is required'),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_EXPIRES_HOURS: int(8, 1, 24 * 30),
  COOKIE_SECURE: flag,
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:8000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: int(0, 0, 10),
  API_RATE_LIMIT_PER_MIN: int(600, 1),
  LOGIN_RATE_LIMIT_MAX: int(10, 1),
  DATA_DIR: z.string().default(path.resolve(process.cwd(), '../data')),
  SEED_ON_START: flag,
  SEED_ADMIN_EMAIL: z.string().default('admin@finpilot.test'),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_VIEWER_EMAIL: z.string().default('viewer@finpilot.test'),
  SEED_VIEWER_PASSWORD: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
}

/** Validated, typed settings. The app refuses to start if anything is missing or malformed. */
export const config = parsed.data;
