/**
 * Runs once before all test files: creates the test database if needed, resets it, migrates.
 */
import pg from 'pg';
import { parseEnv, ROOT_ENV_FILE } from '../src/config/env.js';
import { ensureDatabase, runMigrations } from '../src/db/migrate.js';
import { existsSync } from 'node:fs';

export default async function setup(): Promise<void> {
  if (existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);
  const { env } = parseEnv({ ...process.env, NODE_ENV: 'test' });
  const url = env.databaseUrlTest;
  if (!/_test(\?|$)/.test(new URL(url).pathname + new URL(url).search)) {
    throw new Error(
      `Refusing to reset a database whose name does not end in _test: ${new URL(url).pathname}`,
    );
  }
  await ensureDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade');
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema if exists pgboss cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
