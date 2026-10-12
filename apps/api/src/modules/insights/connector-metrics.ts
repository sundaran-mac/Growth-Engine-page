/**
 * Default metrics fetcher for `metrics.nightly`: asks the PUBLISH connector of the post's platform
 * for lifetime totals. Returns null (skipped, not failed) when the platform has no metrics API
 * (LinkedIn today, WhatsApp) or the account has no usable token.
 */
import { eq } from 'drizzle-orm';
import { getConnector } from '../../connectors/index.js';
import { db } from '../../db/client.js';
import { channelAccounts } from '../../db/schema/index.js';
import { decryptSecret } from '../../lib/crypto.js';
import type { PostMetricsFetcher } from './metrics-nightly.js';

const USABLE_STATUSES = new Set(['connected', 'needs_approval']);

export const connectorMetricsFetcher: PostMetricsFetcher = async (post) => {
  const connector = getConnector(post.platform);
  if (!connector.capabilities.metrics) return null;
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(eq(channelAccounts.id, post.channelAccountId))
    .limit(1);
  if (!account?.accessTokenEnc || !account.externalAccountId) return null;
  if (!USABLE_STATUSES.has(account.status) || !account.allowedActions.includes('insights'))
    return null;

  const m = await connector.fetchMetrics({
    account: {
      externalAccountId: account.externalAccountId,
      accessToken: decryptSecret(account.accessTokenEnc),
      allowedActions: account.allowedActions,
    },
    externalId: post.externalId,
  });
  // Platforms do not report installs or activations; those come from tracked links.
  return {
    ...(m.reach !== null ? { reach: m.reach } : {}),
    ...(m.saves !== null ? { saves: m.saves } : {}),
    ...(m.shares !== null ? { shares: m.shares } : {}),
    ...(m.comments !== null ? { comments: m.comments } : {}),
    ...(m.clicks !== null ? { clicks: m.clicks } : {}),
  };
};
