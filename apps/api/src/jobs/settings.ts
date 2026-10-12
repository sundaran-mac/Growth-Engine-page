/**
 * SETTINGS jobs:
 * - `document.process`: extract text and write the Claude summary of a knowledge document;
 * - `weekly.tick` (every 15 minutes): fail runs stuck in `running` after a worker crash, then
 *   queue the weekly run of each product that is due;
 * - `weekly.run`: one weekly run (ideas, review, Monday note, GitHub pull request).
 */
import type { PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { processDocument } from '../modules/settings/documents.js';
import { documentProcessJob, weeklyRunJob, weeklyTickJob } from '../modules/settings/queue.js';
import { enqueueDueRuns, executeWeeklyRun, failStaleRuns } from '../modules/settings/weekly.js';

export async function register(_boss: PgBoss): Promise<void> {
  await documentProcessJob.work(async (data) => {
    await processDocument(data.documentId);
  });
  await weeklyRunJob.work(async (data) => {
    await executeWeeklyRun(data.runId);
  });
  await weeklyTickJob.work(async () => {
    const failed = await failStaleRuns();
    if (failed.length > 0) logger.warn({ failed: failed.length }, 'stale weekly runs failed');
    const queued = await enqueueDueRuns();
    if (queued.length > 0) logger.info({ queued: queued.length }, 'weekly runs queued');
  });
  await weeklyTickJob.schedule('*/15 * * * *');
}
