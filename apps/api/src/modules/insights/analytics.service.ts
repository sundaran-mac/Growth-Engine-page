/**
 * Analytics screen: summary, installs by channel, value by content mode, per-post ladder.
 */
import {
  computeValueScore,
  CONTENT_MODES,
  type AnalyticsByChannel,
  type AnalyticsByMode,
  type AnalyticsPostsResponse,
  type AnalyticsSummary,
  type ContentMode,
  type ModeInsight,
  type Platform,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { dateKey, iso } from '../../lib/time.js';
import {
  deltaPct,
  isoWeekNumber,
  lastWeekStarts,
  windows,
  withValueScore,
  ZERO_TOTALS,
  type DateWindow,
  type RawTotals,
} from './logic.js';
import {
  piecesByMode,
  reachByWeek,
  sumTotals,
  totalsByChannel,
  totalsByModeAndChannel,
  totalsByPost,
  type PostSort,
} from './metrics.repo.js';

export interface AnalyticsInput {
  productId?: string | undefined;
  days: number;
  now?: Date;
}

function rangeOf(input: AnalyticsInput): { current: DateWindow; previous: DateWindow } {
  const today = dateKey(input.now ?? new Date(), env.appTimezone);
  return windows(today, input.days);
}

const rangeInfo = (w: DateWindow) => ({ days: w.days, from: w.from, to: w.to });

export async function analyticsSummary(input: AnalyticsInput): Promise<AnalyticsSummary> {
  const { current, previous } = rangeOf(input);
  const [cur, prev] = await Promise.all([
    sumTotals(current, input.productId),
    sumTotals(previous, input.productId),
  ]);

  // Reach by week: the weeks the window touches, never fewer than 8 so the trend reads.
  const weekCount = Math.max(8, Math.ceil(input.days / 7) + 1);
  const weekStarts = lastWeekStarts(current.to, weekCount);
  const weekly = await reachByWeek({ from: weekStarts[0]!, to: current.to }, input.productId);

  const t = cur.totals;
  const p = prev.totals;
  return {
    range: rangeInfo(current),
    totals: withValueScore(t),
    previous: withValueScore(p),
    deltas: {
      reach: deltaPct(t.reach, p.reach),
      savesShares: deltaPct(t.saves + t.shares, p.saves + p.shares),
      installs: deltaPct(t.installs, p.installs),
      activations: deltaPct(t.activations, p.activations),
    },
    activationRatePct: t.installs > 0 ? Math.round((t.activations / t.installs) * 100) : null,
    reachByWeek: weekStarts.map((weekStart) => ({
      weekStart,
      isoWeek: isoWeekNumber(weekStart),
      reach: weekly.get(weekStart) ?? 0,
    })),
    isSample: cur.rows > 0 && cur.sampleRows === cur.rows,
    hasData: cur.rows > 0,
  };
}

export async function analyticsByChannel(input: AnalyticsInput): Promise<AnalyticsByChannel> {
  const { current } = rangeOf(input);
  const rows = await totalsByChannel(current, input.productId);
  const items = rows
    .map((r) => ({
      platform: r.platform,
      posts: r.posts,
      reach: r.reach,
      installs: r.installs,
      valueScore: computeValueScore(r),
    }))
    .sort((a, b) => b.installs - a.installs || b.reach - a.reach);
  return { range: rangeInfo(current), items };
}

function add(a: RawTotals, b: RawTotals): RawTotals {
  return {
    reach: a.reach + b.reach,
    saves: a.saves + b.saves,
    shares: a.shares + b.shares,
    comments: a.comments + b.comments,
    clicks: a.clicks + b.clicks,
    installs: a.installs + b.installs,
    activations: a.activations + b.activations,
  };
}

export async function analyticsByMode(input: AnalyticsInput): Promise<AnalyticsByMode> {
  const { current } = rangeOf(input);
  const [rows, pieces] = await Promise.all([
    totalsByModeAndChannel(current, input.productId),
    piecesByMode(current, input.productId),
  ]);

  const perMode = new Map<
    ContentMode,
    { totals: RawTotals; best: { platform: Platform; score: number } | null }
  >();
  for (const r of rows) {
    const entry = perMode.get(r.mode) ?? { totals: { ...ZERO_TOTALS }, best: null };
    entry.totals = add(entry.totals, r);
    const score = computeValueScore(r);
    if (r.reach > 0 && (!entry.best || score > entry.best.score)) {
      entry.best = { platform: r.platform, score };
    }
    perMode.set(r.mode, entry);
  }

  const items: ModeInsight[] = CONTENT_MODES.filter((m) => perMode.has(m)).map((mode) => {
    const e = perMode.get(mode)!;
    return {
      mode,
      pieces: pieces.get(mode) ?? 0,
      reach: e.totals.reach,
      installs: e.totals.installs,
      valuePer1k: computeValueScore(e.totals),
      bestChannel: e.best?.platform ?? null,
    };
  });
  items.sort((a, b) => b.valuePer1k - a.valuePer1k);
  return { range: rangeInfo(current), items };
}

export async function analyticsPosts(
  input: AnalyticsInput & { limit: number; offset: number; sort: PostSort },
): Promise<AnalyticsPostsResponse> {
  const { current } = rangeOf(input);
  const { rows, total } = await totalsByPost(current, input.productId, input);
  return {
    items: rows.map((r) => ({
      postId: r.postId,
      briefId: r.briefId,
      briefCode: r.briefCode,
      title: r.title,
      mode: r.mode,
      platform: r.platform,
      publishedAt: iso(r.publishedAt),
      liveUrl: r.liveUrl,
      ...withValueScore(r),
    })),
    total,
  };
}
