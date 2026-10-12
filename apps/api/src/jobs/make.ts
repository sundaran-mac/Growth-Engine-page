/**
 * make jobs. Owned by the MAKE module agent.
 *
 * - asset.probe: reads the stored object size and type of one asset and marks it ready or failed.
 *   Without an asset id it sweeps uploads left open for more than 24 h (aborts them, marks failed).
 *   The sweep runs every 30 minutes.
 */
import { defineJob, type PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import { probeAsset, sweepStaleUploads } from '../modules/make/assets.service.js';

export interface AssetProbeData {
  assetId?: string;
}

export const assetProbe = defineJob<AssetProbeData>('asset.probe', { retryLimit: 3 });

export async function handleAssetProbe(data: AssetProbeData): Promise<void> {
  if (data.assetId) {
    const result = await probeAsset(data.assetId);
    logger.info({ assetId: data.assetId, result }, 'asset probed');
    return;
  }
  const cleaned = await sweepStaleUploads();
  if (cleaned > 0) logger.info({ cleaned }, 'stale uploads cleaned');
}

export async function register(_boss: PgBoss): Promise<void> {
  await assetProbe.work((data) => handleAssetProbe(data));
  await assetProbe.schedule('*/30 * * * *', {});
}
