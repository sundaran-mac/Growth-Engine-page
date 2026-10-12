/**
 * Database access and DTO mapping for the publish module. Tokens never leave this layer in a DTO.
 */
import { and, asc, count, desc, eq, gte, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  type ApprovalDecision,
  type BriefStage,
  type ChannelAccountView,
  PLATFORM_OAUTH,
  type Platform,
  type Post,
  type PostView,
  type PublishGate,
  type Ratio,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db, type DbOrTx } from '../../db/client.js';
import {
  approvals,
  assets,
  briefs,
  channelAccounts,
  metricSnapshots,
  posts,
  products,
  productSettings,
} from '../../db/schema/index.js';
import { iso } from '../../lib/time.js';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { learnBestWindows, type LearnedWindow } from './best-window.js';
import { channelHow } from './rules.js';

export type ChannelAccountRow = typeof channelAccounts.$inferSelect;
export type PostRow = typeof posts.$inferSelect;
export type BriefRow = typeof briefs.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;

/* ---------- Channel accounts ---------- */

export function howOf(row: ChannelAccountRow, now = new Date()) {
  return channelHow(
    {
      platform: row.platform,
      status: row.status,
      hasToken: Boolean(row.accessTokenEnc),
      allowedActions: row.allowedActions,
      expiresAt: row.expiresAt,
      canRefresh: Boolean(row.refreshTokenEnc),
    },
    now,
  );
}

export function toChannelAccountView(row: ChannelAccountRow): ChannelAccountView {
  return {
    id: row.id,
    platform: row.platform,
    displayName: row.displayName,
    description: row.description,
    handle: row.handle,
    productId: row.productId,
    status: row.status,
    allowedActions: row.allowedActions,
    expiresAt: iso(row.expiresAt),
    lastError: row.lastError,
    connectedAt: iso(row.connectedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    how: howOf(row),
    oauthPlatform: PLATFORM_OAUTH[row.platform],
  };
}

export async function listChannelAccounts(q: {
  productId?: string | undefined;
  platform?: Platform | undefined;
  limit: number;
  offset: number;
}): Promise<{ items: ChannelAccountView[]; total: number }> {
  const conds: SQL[] = [];
  if (q.productId) {
    conds.push(or(isNull(channelAccounts.productId), eq(channelAccounts.productId, q.productId))!);
  }
  if (q.platform) conds.push(eq(channelAccounts.platform, q.platform));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(channelAccounts)
      .where(where)
      .orderBy(asc(channelAccounts.platform), asc(channelAccounts.displayName))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ n: count() }).from(channelAccounts).where(where),
  ]);
  return { items: rows.map(toChannelAccountView), total: totals[0]?.n ?? 0 };
}

export async function getChannelAccount(id: string, tx: DbOrTx = db): Promise<ChannelAccountRow | null> {
  const [row] = await tx.select().from(channelAccounts).where(eq(channelAccounts.id, id)).limit(1);
  return row ?? null;
}

/* ---------- Briefs, products, settings ---------- */

export interface PublishSettings {
  timezone: string;
  launchDate: string | null;
  autoSchedule: boolean;
  utmCampaignPrefix: string | null;
  trackingBaseUrl: string | null;
}

/** Product settings with the table defaults when the product has no settings row yet. */
export async function getPublishSettings(productId: string, tx: DbOrTx = db): Promise<PublishSettings> {
  const [row] = await tx.select().from(productSettings).where(eq(productSettings.productId, productId)).limit(1);
  return {
    timezone: row?.timezone ?? env.appTimezone,
    launchDate: row?.launchDate ?? null,
    autoSchedule: row?.autoSchedule ?? true,
    utmCampaignPrefix: row?.utmCampaignPrefix ?? null,
    trackingBaseUrl: row?.trackingBaseUrl ?? null,
  };
}

/** Only posts from this many days back teach the best window, so it follows the audience. */
export const LEARN_LOOKBACK_DAYS = 180;

/**
 * Learned best windows of a product, keyed by `learnedKey(platform, audienceTz)`. Reads each
 * published post with its summed daily metric snapshots; the choice itself is pure
 * (`learnBestWindows`).
 */
export async function loadLearnedWindows(
  productId: string,
  tx: DbOrTx = db,
  now: Date = new Date(),
): Promise<Map<string, LearnedWindow>> {
  const since = new Date(now.getTime() - LEARN_LOOKBACK_DAYS * 86_400_000);
  const total = (c: AnyPgColumn) => sql<number>`coalesce(sum(${c}), 0)::int`;
  const rows = await tx
    .select({
      platform: channelAccounts.platform,
      audienceTz: posts.audienceTz,
      publishedAt: posts.publishedAt,
      reach: total(metricSnapshots.reach),
      saves: total(metricSnapshots.saves),
      shares: total(metricSnapshots.shares),
      clicks: total(metricSnapshots.clicks),
      installs: total(metricSnapshots.installs),
      activations: total(metricSnapshots.activations),
    })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .innerJoin(metricSnapshots, eq(metricSnapshots.postId, posts.id))
    .where(
      and(
        eq(briefs.productId, productId),
        eq(posts.status, 'published'),
        isNotNull(posts.publishedAt),
        gte(posts.publishedAt, since),
      ),
    )
    .groupBy(posts.id, channelAccounts.platform, posts.audienceTz, posts.publishedAt);
  return learnBestWindows(
    rows.map((r) => ({
      platform: r.platform,
      audienceTz: r.audienceTz,
      publishedAt: r.publishedAt!,
      totals: {
        reach: Number(r.reach),
        saves: Number(r.saves),
        shares: Number(r.shares),
        clicks: Number(r.clicks),
        installs: Number(r.installs),
        activations: Number(r.activations),
      },
    })),
  );
}

export async function getBrief(briefId: string, tx: DbOrTx = db): Promise<BriefRow | null> {
  const [row] = await tx.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
  return row ?? null;
}

export async function getProduct(productId: string, tx: DbOrTx = db) {
  const [row] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
  return row ?? null;
}

const GATE_STAGES: readonly BriefStage[] = ['approved', 'scheduled', 'live'];

/** Both gates approved for the brief's current version, and the brief past approval. */
export async function loadGate(
  brief: Pick<BriefRow, 'id' | 'stage' | 'version'>,
  tx: DbOrTx = db,
): Promise<PublishGate> {
  const rows = await tx
    .select({ gate: approvals.gate, decision: approvals.decision })
    .from(approvals)
    .where(and(eq(approvals.briefId, brief.id), eq(approvals.version, brief.version)));
  const claims: ApprovalDecision | null = rows.find((r) => r.gate === 'claims')?.decision ?? null;
  const brand: ApprovalDecision | null = rows.find((r) => r.gate === 'brand')?.decision ?? null;
  let reason: string | null = null;
  if (!GATE_STAGES.includes(brief.stage)) {
    reason = `The brief is at stage "${brief.stage}". It can go out only after both gates approve it.`;
  } else if (claims !== 'approved') {
    reason = `The claims gate has not approved version ${brief.version}.`;
  } else if (brand !== 'approved') {
    reason = `The brand gate has not approved version ${brief.version}.`;
  }
  return { allowed: reason === null, reason, claims, brand };
}

/* ---------- Posts ---------- */

export function toPost(row: PostRow, platform: Platform): Post {
  return {
    id: row.id,
    briefId: row.briefId,
    briefVersion: row.briefVersion,
    channelAccountId: row.channelAccountId,
    platform,
    assetId: row.assetId,
    format: row.format,
    caption: row.caption,
    languages: row.languages,
    scheduledAt: iso(row.scheduledAt),
    audienceTz: row.audienceTz,
    status: row.status,
    externalId: row.externalId,
    liveUrl: row.liveUrl,
    trackedUrl: row.trackedUrl,
    error: row.error,
    publishedAt: iso(row.publishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPostView(row: PostRow, channel: ChannelAccountRow, asset: AssetRow | null): PostView {
  return {
    ...toPost(row, channel.platform),
    channel: {
      id: channel.id,
      platform: channel.platform,
      displayName: channel.displayName,
      handle: channel.handle,
      status: channel.status,
    },
    how: howOf(channel),
    asset: asset
      ? {
          id: asset.id,
          kind: asset.kind,
          ratio: (asset.ratio as Ratio | null) ?? null,
          fileName: asset.fileName,
          durationMs: asset.durationMs,
        }
      : null,
  };
}

const PLATFORM_ORDER: Record<Platform, number> = {
  instagram: 0,
  youtube: 1,
  linkedin: 2,
  facebook: 3,
  whatsapp: 4,
};

export async function listPostViews(where: SQL, tx: DbOrTx = db): Promise<PostView[]> {
  const rows = await tx
    .select({ post: posts, channel: channelAccounts, asset: assets })
    .from(posts)
    .innerJoin(channelAccounts, eq(posts.channelAccountId, channelAccounts.id))
    .leftJoin(assets, eq(posts.assetId, assets.id))
    .where(where)
    .orderBy(desc(posts.briefVersion), asc(posts.createdAt));
  return rows
    .map((r) => toPostView(r.post, r.channel, r.asset))
    .sort(
      (a, b) =>
        b.briefVersion - a.briefVersion ||
        PLATFORM_ORDER[a.platform] - PLATFORM_ORDER[b.platform] ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export async function getPostView(postId: string, tx: DbOrTx = db): Promise<PostView | null> {
  const items = await listPostViews(eq(posts.id, postId), tx);
  return items[0] ?? null;
}

export interface PostContext {
  post: PostRow;
  channel: ChannelAccountRow;
  brief: BriefRow;
  asset: AssetRow | null;
}

export async function getPostContext(postId: string, tx: DbOrTx = db): Promise<PostContext | null> {
  const [row] = await tx
    .select({ post: posts, channel: channelAccounts, brief: briefs, asset: assets })
    .from(posts)
    .innerJoin(channelAccounts, eq(posts.channelAccountId, channelAccounts.id))
    .innerJoin(briefs, eq(posts.briefId, briefs.id))
    .leftJoin(assets, eq(posts.assetId, assets.id))
    .where(eq(posts.id, postId))
    .limit(1);
  return row ?? null;
}

/** Product of a post, for access checks. */
export async function productIdOfPost(postId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ productId: briefs.productId })
    .from(posts)
    .innerJoin(briefs, eq(posts.briefId, briefs.id))
    .where(eq(posts.id, postId))
    .limit(1);
  return row?.productId;
}

export async function productIdOfBrief(briefId: string): Promise<string | undefined> {
  const [row] = await db.select({ productId: briefs.productId }).from(briefs).where(eq(briefs.id, briefId)).limit(1);
  return row?.productId;
}

/** Ready assets of a brief (any version), newest first. */
export async function readyAssets(briefId: string, tx: DbOrTx = db): Promise<AssetRow[]> {
  return tx
    .select()
    .from(assets)
    .where(and(eq(assets.briefId, briefId), eq(assets.status, 'ready')))
    .orderBy(desc(assets.createdAt));
}

