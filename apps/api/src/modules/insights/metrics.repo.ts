/**
 * Metric queries. `metric_snapshots` hold DAILY values per post, so every number here is a SUM
 * of daily rows over a date window. The value score is always recomputed from those sums with
 * the contract formula (never averaged from daily scores).
 */
import { and, between, desc, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ContentMode, Platform } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { briefs, channelAccounts, metricSnapshots, posts } from '../../db/schema/index.js';
import { toCount } from '../../lib/pagination.js';
import { ZERO_TOTALS, type DateWindow, type RawTotals } from './logic.js';

const sumOf = (col: SQLWrapper) => sql<string>`coalesce(sum(${col}), 0)`.mapWith(toCount);

const totalsSelect = {
  reach: sumOf(metricSnapshots.reach),
  saves: sumOf(metricSnapshots.saves),
  shares: sumOf(metricSnapshots.shares),
  comments: sumOf(metricSnapshots.comments),
  clicks: sumOf(metricSnapshots.clicks),
  installs: sumOf(metricSnapshots.installs),
  activations: sumOf(metricSnapshots.activations),
};

function pickTotals(row: Partial<RawTotals> | undefined): RawTotals {
  if (!row) return { ...ZERO_TOTALS };
  return {
    reach: row.reach ?? 0,
    saves: row.saves ?? 0,
    shares: row.shares ?? 0,
    comments: row.comments ?? 0,
    clicks: row.clicks ?? 0,
    installs: row.installs ?? 0,
    activations: row.activations ?? 0,
  };
}

function scope(win: Pick<DateWindow, 'from' | 'to'>, productId?: string | null): SQL {
  const parts: SQL[] = [between(metricSnapshots.date, win.from, win.to)];
  if (productId) parts.push(eq(briefs.productId, productId));
  return and(...parts)!;
}

/** Sums over a window, plus whether any row exists and whether rows come from sample posts. */
export async function sumTotals(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId?: string | null,
  tx: DbOrTx = db,
): Promise<{ totals: RawTotals; rows: number; sampleRows: number }> {
  const [row] = await tx
    .select({
      ...totalsSelect,
      rows: sql<string>`count(*)`.mapWith(toCount),
      // Seeded sample posts carry external ids that start with "sample-" (seed/index.ts).
      sampleRows: sql<string>`count(*) filter (where ${posts.externalId} like 'sample-%')`.mapWith(
        toCount,
      ),
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(scope(win, productId));
  return { totals: pickTotals(row), rows: row?.rows ?? 0, sampleRows: row?.sampleRows ?? 0 };
}

export interface ChannelRow extends RawTotals {
  platform: Platform;
  posts: number;
}

export async function totalsByChannel(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId?: string | null,
): Promise<ChannelRow[]> {
  const rows = await db
    .select({
      platform: channelAccounts.platform,
      posts: sql<string>`count(distinct ${posts.id})`.mapWith(toCount),
      ...totalsSelect,
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(scope(win, productId))
    .groupBy(channelAccounts.platform);
  return rows.map((r) => ({ platform: r.platform, posts: r.posts, ...pickTotals(r) }));
}

export interface ModeChannelRow extends RawTotals {
  mode: ContentMode;
  platform: Platform;
  pieces: number;
}

/** Totals per content mode and channel (the caller rolls up per mode and picks the best channel). */
export async function totalsByModeAndChannel(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId?: string | null,
): Promise<ModeChannelRow[]> {
  const rows = await db
    .select({
      mode: briefs.mode,
      platform: channelAccounts.platform,
      pieces: sql<string>`count(distinct ${briefs.id})`.mapWith(toCount),
      ...totalsSelect,
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(scope(win, productId))
    .groupBy(briefs.mode, channelAccounts.platform);
  return rows.map((r) => ({
    mode: r.mode,
    platform: r.platform,
    pieces: r.pieces,
    ...pickTotals(r),
  }));
}

/** Distinct briefs per mode (a brief on three channels is one piece). */
export async function piecesByMode(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId?: string | null,
): Promise<Map<ContentMode, number>> {
  const rows = await db
    .select({
      mode: briefs.mode,
      pieces: sql<string>`count(distinct ${briefs.id})`.mapWith(toCount),
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(scope(win, productId))
    .groupBy(briefs.mode);
  return new Map(rows.map((r) => [r.mode, r.pieces]));
}

/** Reach per ISO week (Monday start) between `from` and `to`. */
export async function reachByWeek(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId?: string | null,
): Promise<Map<string, number>> {
  const week = sql<string>`to_char(date_trunc('week', ${metricSnapshots.date}::timestamp), 'YYYY-MM-DD')`;
  const rows = await db
    .select({ weekStart: week, reach: sumOf(metricSnapshots.reach) })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(scope(win, productId))
    .groupBy(week);
  return new Map(rows.map((r) => [r.weekStart, r.reach]));
}

export interface PostRow extends RawTotals {
  postId: string;
  briefId: string;
  briefCode: string;
  title: string;
  mode: ContentMode;
  platform: Platform;
  publishedAt: Date | null;
  liveUrl: string | null;
}

export type PostSort = 'value' | 'reach' | 'installs' | 'published';

export async function totalsByPost(
  win: Pick<DateWindow, 'from' | 'to'>,
  productId: string | null | undefined,
  page: { limit: number; offset: number; sort: PostSort },
): Promise<{ rows: PostRow[]; total: number }> {
  const where = scope(win, productId);
  const points = sql`(sum(${metricSnapshots.saves}) * 3 + sum(${metricSnapshots.shares}) * 4 + sum(${metricSnapshots.clicks}) * 5 + sum(${metricSnapshots.installs}) * 20 + sum(${metricSnapshots.activations}) * 40)`;
  const valueExpr = sql`case when sum(${metricSnapshots.reach}) > 0 then ${points}::numeric / sum(${metricSnapshots.reach}) else 0 end`;
  const order =
    page.sort === 'reach'
      ? desc(sql`sum(${metricSnapshots.reach})`)
      : page.sort === 'installs'
        ? desc(sql`sum(${metricSnapshots.installs})`)
        : page.sort === 'published'
          ? sql`${posts.publishedAt} desc nulls last`
          : desc(valueExpr);

  const rows = await db
    .select({
      postId: posts.id,
      briefId: briefs.id,
      briefCode: briefs.code,
      title: briefs.title,
      mode: briefs.mode,
      platform: channelAccounts.platform,
      publishedAt: posts.publishedAt,
      liveUrl: posts.liveUrl,
      ...totalsSelect,
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(where)
    .groupBy(posts.id, briefs.id, channelAccounts.platform)
    .orderBy(order, posts.id)
    .limit(page.limit)
    .offset(page.offset);

  const [count] = await db
    .select({ n: sql<string>`count(distinct ${posts.id})`.mapWith(toCount) })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(where);

  return {
    rows: rows.map((r) => ({
      postId: r.postId,
      briefId: r.briefId,
      briefCode: r.briefCode,
      title: r.title,
      mode: r.mode,
      platform: r.platform,
      publishedAt: r.publishedAt,
      liveUrl: r.liveUrl,
      ...pickTotals(r),
    })),
    total: count?.n ?? 0,
  };
}
