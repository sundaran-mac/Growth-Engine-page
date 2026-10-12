/**
 * Job queue on pg-boss (lives inside Postgres, in its own `pgboss` schema).
 *
 * - The API process starts it as a sender only (no cron, no maintenance).
 * - The worker process starts it fully and registers handlers (src/jobs).
 * - Modules define their own typed jobs with `defineJob` in `src/jobs/<module>.ts`:
 *
 *     export const kitRefresh = defineJob<{ productId: string }>('kit.refresh', { retryLimit: 3 });
 *     await kitRefresh.send({ productId });                 // from a route or service
 *     await kitRefresh.work(async (data) => { ... });       // in register(boss)
 *     await kitRefresh.schedule('0 7 * * 1', {});           // cron in APP_TIMEZONE
 */
import { PgBoss, type Job, type SendOptions, type WorkOptions } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export type { PgBoss };

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;
const knownQueues = new Set<string>();

export interface StartQueueOptions {
  /** true in the worker: runs cron, maintenance and handlers. */
  worker: boolean;
  connectionString?: string;
}

export async function startQueue(opts: StartQueueOptions): Promise<PgBoss> {
  if (boss) return boss;
  if (starting) return starting;
  starting = (async () => {
    const instance = new PgBoss({
      connectionString:
        opts.connectionString ?? (env.isTest ? env.databaseUrlTest : env.databaseUrl),
      schema: 'pgboss',
      application_name: opts.worker ? 'growth-desk-worker' : 'growth-desk-api',
      max: opts.worker ? 5 : 2,
      schedule: opts.worker && env.workerEnableCron,
      supervise: opts.worker,
      migrate: true,
    });
    instance.on('error', (err) => logger.error({ err }, 'queue error'));
    await instance.start({ attempts: 5 });
    boss = instance;
    logger.info({ worker: opts.worker }, 'queue started');
    return instance;
  })();
  try {
    return await starting;
  } finally {
    starting = null;
  }
}

export function getQueue(): PgBoss {
  if (!boss) throw new Error('Queue not started. Call startQueue() first.');
  return boss;
}

export function isQueueStarted(): boolean {
  return boss !== null;
}

export async function stopQueue(): Promise<void> {
  if (!boss) return;
  const b = boss;
  boss = null;
  knownQueues.clear();
  await b.stop({ graceful: true, timeout: 20_000 });
}

/** Creates the queue once per process (pg-boss needs it before send or work). */
export async function ensureQueue(name: string): Promise<void> {
  if (knownQueues.has(name)) return;
  const b = getQueue();
  const existing = await b.getQueue(name);
  if (!existing) await b.createQueue(name);
  knownQueues.add(name);
}

export type JobHandler<T> = (data: T, job: Job<T>) => Promise<void>;

export interface JobDefinition<T extends object> {
  readonly name: string;
  /** Queue a job now (or later with `startAfter`). Returns the job id, or null if de-duplicated. */
  send(data: T, options?: SendOptions): Promise<string | null>;
  /** Cron schedule in APP_TIMEZONE (worker only). One schedule per job name. */
  schedule(cron: string, data?: T, options?: SendOptions): Promise<void>;
  /** Register the handler (worker only). Each job in a batch runs on its own. */
  work(handler: JobHandler<T>, options?: WorkOptions): Promise<string>;
}

/** Default retry policy: 3 retries with backoff. Fail-safe flows (publish) pass `retryLimit: 0`. */
const DEFAULT_SEND: SendOptions = { retryLimit: 3, retryDelay: 30, retryBackoff: true };

export function defineJob<T extends object>(
  name: string,
  defaults: SendOptions = {},
): JobDefinition<T> {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$/.test(name)) {
    throw new Error(`Job name must look like "module.action": ${name}`);
  }
  const sendDefaults = { ...DEFAULT_SEND, ...defaults };
  return {
    name,
    async send(data, options) {
      await ensureQueue(name);
      return getQueue().send(name, data, { ...sendDefaults, ...options });
    },
    async schedule(cron, data, options) {
      await ensureQueue(name);
      await getQueue().schedule(name, cron, data ?? {}, {
        ...sendDefaults,
        ...options,
        tz: env.appTimezone,
      });
    },
    async work(handler, options) {
      await ensureQueue(name);
      return getQueue().work<T>(name, { batchSize: 1, ...options }, async (jobs) => {
        for (const job of jobs) {
          const started = Date.now();
          const log = logger.child({ job: name, jobId: job.id, retry: job.retryCount });
          try {
            await handler(job.data, job);
            log.info({ ms: Date.now() - started }, 'job done');
          } catch (err) {
            log.error({ err, ms: Date.now() - started }, 'job failed');
            throw err;
          }
        }
      });
    },
  };
}

/** Health probe used by GET /health. */
export async function checkQueue(): Promise<void> {
  const b = getQueue();
  const installed = await b.isInstalled();
  if (!installed) throw new Error('pg-boss schema is not installed');
}
