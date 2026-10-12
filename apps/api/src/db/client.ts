/**
 * Postgres pool + Drizzle instance. One pool per process.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
/** A transaction handle has the same query API as `Db`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

// Return `date` columns as plain `YYYY-MM-DD` strings, never shifted by the local zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

export function createPool(connectionString: string, max = env.databasePoolMax): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, application_name: 'growth-desk-api' });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));
  return pool;
}

const connectionString = env.isTest ? env.databaseUrlTest : env.databaseUrl;

export const pool = createPool(connectionString);
export const db: Db = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}

export { schema };
