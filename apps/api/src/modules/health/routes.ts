/**
 * Health (owned by FOUNDATION-API):
 *   GET /api/v1/health/live  -> 200 { status: 'ok' } when the process is up (no dependencies).
 *   GET /api/v1/health       -> 200 when database is up (storage or queue down = degraded),
 *                               503 when the database is down.
 */
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import type { ComponentHealth, HealthResponse } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { checkQueue, isQueueStarted } from '../../lib/queue.js';
import { checkStorage, isStorageEnabled } from '../../lib/storage.js';

export const healthRouter: Router = Router();

const VERSION = process.env.npm_package_version ?? '0.1.0';

async function probe(fn: () => Promise<unknown>): Promise<ComponentHealth> {
  const started = performance.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 3000).unref()),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started), detail: null };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
    };
  }
}

const disabled = (detail: string): ComponentHealth => ({
  status: 'disabled',
  latencyMs: null,
  detail,
});

healthRouter.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

healthRouter.get('/health', async (_req, res) => {
  const [database, storage, queue] = await Promise.all([
    probe(() => db.execute(sql`select 1`)),
    isStorageEnabled() ? probe(checkStorage) : Promise.resolve(disabled('storage keys not set')),
    isQueueStarted()
      ? probe(checkQueue)
      : Promise.resolve<ComponentHealth>({
          status: 'down',
          latencyMs: null,
          detail: 'queue not started',
        }),
  ]);
  const status: HealthResponse['status'] =
    database.status !== 'up'
      ? 'down'
      : storage.status === 'down' || queue.status === 'down'
        ? 'degraded'
        : 'ok';
  const body: HealthResponse = {
    status,
    version: VERSION,
    time: new Date().toISOString(),
    checks: { database, storage, queue },
    features: env.features,
  };
  res.status(status === 'down' ? 503 : 200).json(body);
});
