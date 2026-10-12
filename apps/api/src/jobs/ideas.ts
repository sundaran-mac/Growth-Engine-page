/**
 * ideas jobs. Owned by the IDEAS module agent.
 *
 * The Monday run ("ideas.weekly" in the first plan) moved to SETTINGS' per-product `weekly.run`
 * (BUILD-PLAN section 10). That job calls `generateIdeas` and `reviewIdeas` from
 * `modules/ideas/shared.ts`. "Generate with Claude" on the board runs in the request, because
 * the person waits for the result.
 *
 * memory.backfill (content memory, ADR 0009)
 * - `{}`: loads ideas, brief hooks and published captions made before the memory existed and
 *   adds missing embeddings. Idempotent. Queued by hand (or `npm run memory:backfill`); the API
 *   also runs it once on start in development.
 */
import { defineJob, type PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { backfillMemory } from '../modules/memory/backfill.js';

export const memoryBackfillJob = defineJob<Record<string, never>>('memory.backfill', {
  retryLimit: 1,
  retryDelay: 300,
});

export async function register(_boss: PgBoss): Promise<void> {
  await memoryBackfillJob.work(async () => {
    const result = await backfillMemory();
    logger.info(result, 'memory.backfill finished');
  });
}
