import { existsSync } from 'node:fs';
import path from 'node:path';

// Local runs read the repo's .env. In CI the values come from the workflow's environment (already set, so they win).
if (existsSync('../.env')) process.loadEnvFile('../.env');

/** Credentials and secrets are never written in code: they must come from the environment. */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    // Print and exit (rather than throw): an error thrown this early is hidden by the test runner's own crash report.
    console.error(`\n${name} is not set. Copy .env.example to .env (or set it in the environment) before running the tests.\n`);
    process.exit(1);
  }
  return value;
};

const devUrl = new URL(required('DATABASE_URL'));

/** Tests never touch the dev database: they use "<name>_test" on the same server, recreated for every run. */
const testUrl = new URL(devUrl);
testUrl.pathname = '/finpilot_test';
const adminUrl = new URL(devUrl);
adminUrl.pathname = '/postgres';

export const TEST_DATABASE_URL = testUrl.toString();
export const ADMIN_DATABASE_URL = adminUrl.toString();

// The demo users the seed creates; the tests sign in as them.
export const ADMIN = { email: required('SEED_ADMIN_EMAIL'), password: required('SEED_ADMIN_PASSWORD') };
export const VIEWER = { email: required('SEED_VIEWER_EMAIL'), password: required('SEED_VIEWER_PASSWORD') };

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_HOURS: '8',
  COOKIE_SECURE: 'false',
  CORS_ORIGINS: 'http://localhost:3000,http://localhost:8000',
  TRUST_PROXY: '0',
  API_RATE_LIMIT_PER_MIN: '100000',
  LOGIN_RATE_LIMIT_MAX: '100000',
  DATA_DIR: path.resolve(__dirname, '../../data'),
  SEED_ADMIN_EMAIL: ADMIN.email,
  SEED_ADMIN_PASSWORD: ADMIN.password,
  SEED_VIEWER_EMAIL: VIEWER.email,
  SEED_VIEWER_PASSWORD: VIEWER.password,
};
