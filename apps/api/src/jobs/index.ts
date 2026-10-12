/**
 * Registers every job handler and schedule. Owned by FOUNDATION-API (pre-created).
 * Module agents fill `jobs/<module>.ts` and never edit this file.
 */
import type { PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { register as gates } from './gates.js';
import { register as ideas } from './ideas.js';
import { register as insights } from './insights.js';
import { register as make } from './make.js';
import { register as products } from './products.js';
import { register as publish } from './publish.js';
import { register as settings } from './settings.js';
import { register as system } from './system.js';

const registrations: [string, (boss: PgBoss) => Promise<void>][] = [
  ['system', system],
  ['products', products],
  ['ideas', ideas],
  ['make', make],
  ['gates', gates],
  ['publish', publish],
  ['insights', insights],
  ['settings', settings],
];

export async function registerJobs(boss: PgBoss): Promise<void> {
  for (const [name, register] of registrations) {
    await register(boss);
    logger.debug({ module: name }, 'jobs registered');
  }
}
