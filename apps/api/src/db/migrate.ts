/**
 * Applies SQL migrations from apps/api/drizzle. Used by `npm run db:migrate`, Docker start and tests.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
/** Same path from src/db and dist/db. */
export const MIGRATIONS_FOLDER = resolve(here, '../../drizzle');

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1, application_name: 'growth-desk-migrate' });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

/** Creates the database named in the URL if it does not exist (dev and test helper). */
export async function ensureDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const found = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (found.rowCount === 0) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const { env } = await import('../config/env.js');
  const target = env.isTest ? env.databaseUrlTest : env.databaseUrl;
  const safe = new URL(target);
  safe.password = '***';
  console.log(`Running migrations on ${safe.toString()}`);
  try {
    if (!env.isProduction) await ensureDatabase(target);
    await runMigrations(target);
    console.log('Migrations done.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  }
}
