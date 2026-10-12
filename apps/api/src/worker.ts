/**
 * Worker entry: runs job handlers and cron schedules (pg-boss). Same image as the API.
 */
import { envWarnings } from './config/env.js';
import { closeDb } from './db/client.js';
import { registerJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';
import { startQueue, stopQueue } from './lib/queue.js';

for (const w of envWarnings) logger.warn(w);

const boss = await startQueue({ worker: true });
await registerJobs(boss);
logger.info('worker ready');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  const force = setTimeout(() => process.exit(1), 30_000);
  force.unref();
  await stopQueue().catch((err: unknown) => logger.error({ err }, 'queue stop failed'));
  await closeDb().catch((err: unknown) => logger.error({ err }, 'db close failed'));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
