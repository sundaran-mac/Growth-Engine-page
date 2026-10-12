import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnector, type Connector } from '../../connectors/index.js';
import { db } from '../../db/client.js';
import { channelAccounts } from '../../db/schema/index.js';
import { encryptSecret } from '../../lib/crypto.js';
import { truncateAll } from '../../../test/helpers.js';
import { connectorMetricsFetcher } from './connector-metrics.js';
import type { PostForMetrics } from './metrics-nightly.js';

vi.mock('../../connectors/index.js', () => ({ getConnector: vi.fn() }));
const getConnectorMock = vi.mocked(getConnector);

function fakeConnector(metrics: boolean): Connector & { fetchMetrics: ReturnType<typeof vi.fn> } {
  return {
    platform: 'instagram',
    capabilities: { metrics } as Connector['capabilities'],
    publish: vi.fn(),
    fetchMetrics: vi
      .fn()
      .mockResolvedValue({ reach: 1200, saves: 30, shares: null, comments: 4, clicks: null }),
  };
}

async function account(opts: { token?: boolean; actions?: ('insights' | 'publish')[] } = {}) {
  const [row] = await db
    .insert(channelAccounts)
    .values({
      platform: 'instagram',
      displayName: 'IG',
      externalAccountId: 'ig-1',
      status: 'connected',
      allowedActions: opts.actions ?? ['publish', 'insights'],
      accessTokenEnc: opts.token === false ? null : encryptSecret('token-123'),
    })
    .returning();
  return row!;
}

const post = (
  channelAccountId: string,
  platform: PostForMetrics['platform'] = 'instagram',
): PostForMetrics => ({
  id: '00000000-0000-4000-8000-000000000001',
  platform,
  channelAccountId,
  externalId: 'media-1',
  publishedAt: new Date(),
});

describe('connectorMetricsFetcher', () => {
  beforeEach(async () => {
    await truncateAll();
    getConnectorMock.mockReset();
  });

  it('asks the connector with decrypted credentials and drops unknown numbers', async () => {
    const c = fakeConnector(true);
    getConnectorMock.mockReturnValue(c);
    const acc = await account();
    const result = await connectorMetricsFetcher(post(acc.id));
    expect(result).toEqual({ reach: 1200, saves: 30, comments: 4 });
    expect(c.fetchMetrics).toHaveBeenCalledWith({
      account: {
        externalAccountId: 'ig-1',
        accessToken: 'token-123',
        allowedActions: ['publish', 'insights'],
      },
      externalId: 'media-1',
    });
  });

  it('skips platforms without metrics (LinkedIn) and accounts without a token or insights', async () => {
    const off = fakeConnector(false);
    getConnectorMock.mockReturnValue(off);
    const acc = await account();
    expect(await connectorMetricsFetcher(post(acc.id, 'linkedin'))).toBeNull();
    expect(off.fetchMetrics).not.toHaveBeenCalled();

    const on = fakeConnector(true);
    getConnectorMock.mockReturnValue(on);
    await truncateAll();
    const noToken = await account({ token: false });
    expect(await connectorMetricsFetcher(post(noToken.id))).toBeNull();
    await truncateAll();
    const noInsights = await account({ actions: ['publish'] });
    expect(await connectorMetricsFetcher(post(noInsights.id))).toBeNull();
    expect(on.fetchMetrics).not.toHaveBeenCalled();
  });
});
