/**
 * Nightly metrics pull. For each published post, ask its channel connector for LIFETIME totals,
 * then store the DAILY value for the day (lifetime minus earlier daily rows) in metric_snapshots.
 *
 * The connector call is injected (`PostMetricsFetcher`): PUBLISH owns the connectors.
 * A fetcher returns null when a platform cannot give numbers (WhatsApp, not connected).
 * One post failing never stops the others; nothing is retried silently.
 */
import { and, eq, gte, lt, sql, type SQLWrapper } from 'drizzle-orm';
import { computeValueScore, type Platform } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { channelAccounts, metricSnapshots, posts } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { toCount } from '../../lib/pagination.js';
import { DAY_MS, dateKey } from '../../lib/time.js';
import { addDays, dailyFromLifetime, ZERO_TOTALS, type RawTotals } from './logic.js';

export interface PostForMetrics {
  id: string;
  platform: Platform;
  channelAccountId: string;
  externalId: string;
  publishedAt: Date;
}

/** Lifetime totals so far. Leave out what the platform does not report (installs come from UTM). */
export type LifetimeMetrics = Partial<RawTotals>;

export type PostMetricsFetcher = (post: PostForMetrics) => Promise<LifetimeMetrics | null>;

export interface NightlyResult {
  date: string;
  posts: number;
  stored: number;
  skipped: number;
  failed: number;
}

/** How far back we keep pulling a post's numbers. */
export const METRICS_LOOKBACK_DAYS = 90;

export async function runNightlyMetrics(
  fetcher: PostMetricsFetcher,
  opts: { now?: Date } = {},
): Promise<NightlyResult> {
  const now = opts.now ?? new Date();
  // The pull runs after midnight and records the day that just ended.
  const date = addDays(dateKey(now, env.appTimezone), -1);
  const since = new Date(now.getTime() - METRICS_LOOKBACK_DAYS * DAY_MS);

  const list = await db
    .select({
      id: posts.id,
      platform: channelAccounts.platform,
      channelAccountId: posts.channelAccountId,
      externalId: posts.externalId,
      publishedAt: posts.publishedAt,
    })
    .from(posts)
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(and(eq(posts.status, 'published'), gte(posts.publishedAt, since)));

  const result: NightlyResult = { date, posts: list.length, stored: 0, skipped: 0, failed: 0 };
  for (const p of list) {
    if (!p.externalId || !p.publishedAt) {
      result.skipped += 1;
      continue;
    }
    const post: PostForMetrics = { ...p, externalId: p.externalId, publishedAt: p.publishedAt };
    let lifetime: LifetimeMetrics | null;
    try {
      lifetime = await fetcher(post);
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, postId: p.id, platform: p.platform }, 'metrics fetch failed');
      continue;
    }
    if (!lifetime) {
      result.skipped += 1;
      continue;
    }
    const before = await sumBefore(p.id, date);
    const daily = dailyFromLifetime(lifetime, before);
    await db
      .insert(metricSnapshots)
      .values({ postId: p.id, date, ...daily, valueScore: computeValueScore(daily) })
      .onConflictDoUpdate({
        target: [metricSnapshots.postId, metricSnapshots.date],
        set: { ...daily, valueScore: computeValueScore(daily) },
      });
    result.stored += 1;
  }

  await writeAudit({
    actorId: null,
    action: 'metrics.nightly',
    entity: 'metric_snapshot',
    entityId: date,
    after: result,
  });
  logger.info({ ...result }, 'nightly metrics done');
  return result;
}

async function sumBefore(postId: string, date: string): Promise<RawTotals> {
  const s = (c: SQLWrapper) => sql<string>`coalesce(sum(${c}), 0)`.mapWith(toCount);
  const [row] = await db
    .select({
      reach: s(metricSnapshots.reach),
      saves: s(metricSnapshots.saves),
      shares: s(metricSnapshots.shares),
      comments: s(metricSnapshots.comments),
      clicks: s(metricSnapshots.clicks),
      installs: s(metricSnapshots.installs),
      activations: s(metricSnapshots.activations),
    })
    .from(metricSnapshots)
    .where(and(eq(metricSnapshots.postId, postId), lt(metricSnapshots.date, date)));
  return row ?? { ...ZERO_TOTALS };
}
