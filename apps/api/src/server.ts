/**
 * HTTP server entry. Starts the queue as a sender (no cron here), then listens.
 */
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { env, envWarnings } from './config/env.js';
import { closeDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { startQueue, stopQueue } from './lib/queue.js';
import { backfillOnStart } from './modules/memory/backfill.js';

for (const w of envWarnings) logger.warn(w);

try {
  await startQueue({ worker: false });
} catch (err) {
  // The API still serves; /health reports the queue as down.
  logger.error({ err }, 'queue did not start');
}

const app = createApp();
const server: Server = app.listen(env.port, () => {
  logger.info({ port: env.port, env: env.nodeEnv, features: env.features }, 'api listening');
  // Development only: load older content into the content memory (idempotent, background).
  if (env.nodeEnv === 'development') backfillOnStart();
});
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();
  server.close();
  await stopQueue().catch((err: unknown) => logger.error({ err }, 'queue stop failed'));
  await closeDb().catch((err: unknown) => logger.error({ err }, 'db close failed'));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
