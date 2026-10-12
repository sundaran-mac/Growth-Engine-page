/**
 * insights jobs. Owned by the INSIGHTS module agent.
 *
 * - `metrics.nightly` (02:30 APP_TIMEZONE): pulls each published post's numbers through the
 *   connector (`getConnector(platform).fetchMetrics`) and stores the daily snapshot. Platforms
 *   without a metrics API (LinkedIn, WhatsApp) are skipped, never failed.
 * - The Monday note is written by SETTINGS' weekly run (it calls `writeMondayNote`), so no
 *   separate `note.monday` cron runs here (it would write the same note twice).
 */
import { defineJob, type PgBoss } from '../lib/queue.js';
import { connectorMetricsFetcher } from '../modules/insights/connector-metrics.js';
import { runNightlyMetrics, type PostMetricsFetcher } from '../modules/insights/metrics-nightly.js';

export const metricsNightly = defineJob<Record<string, never>>('metrics.nightly', {
  // A failed pull is logged with per-post counts; the next night tries again. No silent retry storm.
  retryLimit: 1,
  retryDelay: 600,
});

let fetcher: PostMetricsFetcher = connectorMetricsFetcher;

/** Test hook: swap the fetcher (defaults to the PUBLISH connectors). */
export function setMetricsFetcher(f: PostMetricsFetcher): void {
  fetcher = f;
}

export async function register(_boss: PgBoss): Promise<void> {
  await metricsNightly.work(async () => {
    await runNightlyMetrics(fetcher);
  });
  await metricsNightly.schedule('30 2 * * *', {});
}
