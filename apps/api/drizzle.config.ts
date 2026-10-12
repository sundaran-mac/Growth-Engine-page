/**
 * drizzle-kit config. `npm run db:generate` writes SQL migrations to ./drizzle from src/db/schema.
 * Review every generated file before committing it.
 */
import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== ''
        ? process.env.DATABASE_URL
        : 'postgres://growthdesk:growthdesk-dev@localhost:5433/growth_desk',
  },
});
