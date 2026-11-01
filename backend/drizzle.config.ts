import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only reads the schema; the URL is needed for kit commands that touch the DB.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/finpilot',
  },
});
