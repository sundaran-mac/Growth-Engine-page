/**
 * products jobs (PRODUCTS agent).
 *
 * kit.refresh
 * - `{ productId }`: refresh one product's kit against its repo (queued from code).
 * - `{}` (daily cron 06:00 in APP_TIMEZONE): every product with a repo and a signed kit;
 *   the owner and backup get a `kit_changed` notification when spec files changed.
 * Nothing in the kit changes on its own; a person reads the list and edits the kit.
 */
import { defineJob, type PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { refreshAllKits, refreshKit } from '../modules/products/kit-refresh.js';

export interface KitRefreshJob {
  productId?: string;
}

export const kitRefreshJob = defineJob<KitRefreshJob>('kit.refresh', {
  retryLimit: 2,
  retryDelay: 300,
  retryBackoff: true,
});

export const KIT_REFRESH_CRON = '0 6 * * *';

export async function handleKitRefresh(data: KitRefreshJob): Promise<void> {
  if (data.productId) {
    await refreshKit(
      data.productId,
      { actorId: null, requestId: null, ip: null },
      { notify: true },
    );
    return;
  }
  const result = await refreshAllKits();
  logger.info(result, 'kit.refresh run finished');
}

export async function register(_boss: PgBoss): Promise<void> {
  await kitRefreshJob.work(async (data) => handleKitRefresh(data));
  await kitRefreshJob.schedule(KIT_REFRESH_CRON, {});
}
