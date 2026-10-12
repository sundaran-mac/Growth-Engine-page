/**
 * Job definitions of the SETTINGS module. Kept apart from `jobs/settings.ts` (which registers
 * the handlers) so services can send jobs without an import cycle.
 */
import { defineJob } from '../../lib/queue.js';

/** Extract text and write the Claude summary for one knowledge document. */
export const documentProcessJob = defineJob<{ documentId: string }>('document.process', {
  retryLimit: 2,
  retryDelay: 60,
  retryBackoff: true,
});

/** One weekly run. Never retried silently: a failure is recorded and the owner is told. */
export const weeklyRunJob = defineJob<{ runId: string }>('weekly.run', { retryLimit: 0 });

/** Every 15 minutes: queue the weekly run of each product whose local day and time passed. */
export const weeklyTickJob = defineJob<Record<string, never>>('weekly.tick', { retryLimit: 0 });
