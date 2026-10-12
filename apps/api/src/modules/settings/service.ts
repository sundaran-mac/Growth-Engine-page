/**
 * SETTINGS service: product settings, posting slots, product channels and the schedule view.
 * Documents live in documents.ts, weekly runs in weekly.ts.
 */
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  PLATFORMS,
  type NextSlot,
  type Platform,
  type PostingSlot,
  type ProductChannelInput,
  type ProductChannelView,
  type ProductSettings,
  type ProductSettingsDetail,
  type ScheduleItem,
  type ScheduleResponse,
  type UpdateProductSettings,
  type PostingSlotInput,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db, type DbOrTx } from '../../db/client.js';
import {
  briefs,
  channelAccounts,
  postingSlots,
  posts,
  productChannels,
  productSettings,
  products,
} from '../../db/schema/index.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import { getMonthlyUsage } from '../../lib/claude.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { isClaudeEnabled } from '../../lib/claude.js';
import { isStorageEnabled } from '../../lib/storage.js';
import { monthKey } from '../../lib/time.js';
import { isGithubEnabled } from './github.js';
import {
  earliestSlotTime,
  expandSlots,
  removeTaken,
  SLOT_CONFLICT_WINDOW_MS,
  type SlotCandidate,
  type SlotRule,
  type TakenPost,
} from './slots.js';

export type AuditCtx = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;
type SettingsRow = typeof productSettings.$inferSelect;
type SlotRow = typeof postingSlots.$inferSelect;

const hhmm = (t: string) => t.slice(0, 5);

/* ---------- Products ---------- */

export async function getProductOr404(
  productId: string,
  tx: DbOrTx = db,
): Promise<{
  id: string;
  name: string;
  ownerId: string | null;
  backupId: string | null;
  repoUrl: string | null;
}> {
  const [row] = await tx
    .select({
      id: products.id,
      name: products.name,
      ownerId: products.ownerId,
      backupId: products.backupId,
      repoUrl: products.repoUrl,
    })
    .from(products)
    .where(eq(products.id, productId));
  if (!row) throw notFound('Product');
  return row;
}

/* ---------- Settings ---------- */

/** The settings row, created with defaults the first time a product is read. */
export async function ensureSettingsRow(productId: string, tx: DbOrTx = db): Promise<SettingsRow> {
  const [existing] = await tx
    .select()
    .from(productSettings)
    .where(eq(productSettings.productId, productId));
  if (existing) return existing;
  await getProductOr404(productId, tx);
  await tx
    .insert(productSettings)
    .values({ productId, timezone: env.appTimezone })
    .onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(productSettings)
    .where(eq(productSettings.productId, productId));
  if (!row) throw notFound('Product settings');
  return row;
}

export function toSettingsDto(row: SettingsRow): ProductSettings {
  return {
    productId: row.productId,
    timezone: row.timezone,
    launchDate: row.launchDate,
    weeklyRunEnabled: row.weeklyRunEnabled,
    weeklyRunDay: row.weeklyRunDay,
    weeklyRunTime: hhmm(row.weeklyRunTime),
    weeklyIdeasCount: row.weeklyIdeasCount,
    weeklyModes: row.weeklyModes,
    githubRepo: row.githubRepo,
    githubBaseBranch: row.githubBaseBranch,
    weeklyPrEnabled: row.weeklyPrEnabled,
    approvalSlaHours: row.approvalSlaHours,
    utmCampaignPrefix: row.utmCampaignPrefix,
    trackingBaseUrl: row.trackingBaseUrl,
    claudeMonthlyTokenCap: row.claudeMonthlyTokenCap,
    autoSchedule: row.autoSchedule,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSettingsDetail(
  productId: string,
  canEdit: boolean,
): Promise<ProductSettingsDetail> {
  const row = await ensureSettingsRow(productId);
  const month = monthKey(new Date(), row.timezone);
  const usage = await getMonthlyUsage(productId, month);
  return {
    ...toSettingsDto(row),
    claudeUsage: {
      month,
      usedTokens: usage.inputTokens + usage.outputTokens,
      capTokens: row.claudeMonthlyTokenCap ?? usage.capTokens,
    },
    features: { claude: isClaudeEnabled(), github: isGithubEnabled(), storage: isStorageEnabled() },
    canEdit,
  };
}

export async function updateSettings(
  productId: string,
  patch: UpdateProductSettings,
  ctx: AuditCtx,
): Promise<ProductSettings> {
  return db.transaction(async (tx) => {
    const before = await ensureSettingsRow(productId, tx);
    const next = { ...before, ...patch };
    if (next.weeklyPrEnabled && !next.githubRepo) {
      throw badRequest(
        'Set the GitHub repo before turning on weekly pull requests.',
        'VALIDATION_FAILED',
        [{ path: 'githubRepo', message: 'Needed for weekly pull requests' }],
      );
    }
    const [row] = await tx
      .update(productSettings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(productSettings.productId, productId))
      .returning();
    const after = toSettingsDto(row!);
    await writeAudit(
      {
        ...ctx,
        action: 'settings.update',
        entity: 'product_settings',
        entityId: productId,
        before: toSettingsDto(before),
        after,
      },
      tx,
    );
    return after;
  });
}

/* ---------- Posting slots ---------- */

export function toSlotDto(row: SlotRow): PostingSlot {
  return {
    id: row.id,
    productId: row.productId,
    platform: row.platform,
    weekday: row.weekday,
    localTime: hhmm(row.localTime),
    audienceTimezone: row.audienceTimezone,
    label: row.label,
    active: row.active,
    sort: row.sort,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSlots(productId: string): Promise<PostingSlot[]> {
  await getProductOr404(productId);
  const rows = await db
    .select()
    .from(postingSlots)
    .where(eq(postingSlots.productId, productId))
    .orderBy(
      asc(postingSlots.sort),
      asc(postingSlots.platform),
      asc(postingSlots.weekday),
      asc(postingSlots.localTime),
    );
  return rows.map(toSlotDto);
}

/** Replaces every slot of the product in one transaction. */
export async function replaceSlots(
  productId: string,
  slots: PostingSlotInput[],
  ctx: AuditCtx,
): Promise<PostingSlot[]> {
  return db.transaction(async (tx) => {
    await getProductOr404(productId, tx);
    const before = await tx
      .select()
      .from(postingSlots)
      .where(eq(postingSlots.productId, productId));
    await tx.delete(postingSlots).where(eq(postingSlots.productId, productId));
    const rows =
      slots.length === 0
        ? []
        : await tx
            .insert(postingSlots)
            .values(
              slots.map((s, i) => ({
                productId,
                platform: s.platform,
                weekday: s.weekday,
                localTime: s.localTime,
                audienceTimezone: s.audienceTimezone,
                label: s.label ?? null,
                active: s.active ?? true,
                sort: i,
              })),
            )
            .returning();
    const after = rows.map(toSlotDto);
    await writeAudit(
      {
        ...ctx,
        action: 'slots.replace',
        entity: 'posting_slots',
        entityId: productId,
        before: before.map(toSlotDto),
        after,
      },
      tx,
    );
    return after;
  });
}

async function loadSlotRules(
  productId: string,
  platforms: readonly Platform[],
  tx: DbOrTx,
): Promise<SlotRule[]> {
  if (platforms.length === 0) return [];
  const rows = await tx
    .select()
    .from(postingSlots)
    .where(
      and(
        eq(postingSlots.productId, productId),
        eq(postingSlots.active, true),
        inArray(postingSlots.platform, [...platforms]),
      ),
    )
    .orderBy(asc(postingSlots.sort));
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    weekday: r.weekday,
    localTime: r.localTime,
    audienceTimezone: r.audienceTimezone,
    label: r.label,
  }));
}

/** Posts that hold a time on the product's channels (anything not draft, not failed). */
async function loadTakenPosts(
  productId: string,
  platforms: readonly Platform[],
  from: Date,
  to: Date,
  tx: DbOrTx,
): Promise<TakenPost[]> {
  const lo = new Date(from.getTime() - SLOT_CONFLICT_WINDOW_MS);
  const hi = new Date(to.getTime() + SLOT_CONFLICT_WINDOW_MS);
  const rows = await tx
    .select({ platform: channelAccounts.platform, at: posts.scheduledAt })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(
      and(
        eq(briefs.productId, productId),
        inArray(channelAccounts.platform, [...platforms]),
        inArray(posts.status, ['scheduled', 'publishing', 'published', 'manual_pending']),
        gte(posts.scheduledAt, lo),
        lt(posts.scheduledAt, hi),
      ),
    );
  return rows.flatMap((r) => (r.at ? [{ platform: r.platform, at: r.at }] : []));
}

/** Window size used when searching forward for free slots. */
const SEARCH_WINDOW_DAYS = 56;
/** Stop searching after about two years. */
const MAX_WINDOWS = 13;

/** Next `count` free slots over the given platforms, never before the launch date. */
export async function computeNextFreeSlots(
  productId: string,
  platforms: readonly Platform[],
  from: Date,
  count: number,
  tx: DbOrTx = db,
): Promise<SlotCandidate[]> {
  if (count <= 0) return [];
  const settings = await ensureSettingsRow(productId, tx);
  const rules = await loadSlotRules(productId, platforms, tx);
  if (rules.length === 0) return [];
  let start = earliestSlotTime(from, settings.launchDate, settings.timezone);
  const out: SlotCandidate[] = [];
  for (let w = 0; w < MAX_WINDOWS && out.length < count; w += 1) {
    const end = new Date(start.getTime() + SEARCH_WINDOW_DAYS * 24 * 3600 * 1000);
    const candidates = expandSlots(rules, start, end);
    const taken = await loadTakenPosts(productId, platforms, start, end, tx);
    out.push(...removeTaken(candidates, taken));
    start = end;
  }
  return out.slice(0, count);
}

export function toNextSlotDto(c: SlotCandidate): NextSlot {
  return {
    slotId: c.slotId,
    platform: c.platform,
    at: c.at.toISOString(),
    audienceTimezone: c.audienceTimezone,
    label: c.label,
  };
}

/** Free slots inside a range (future only, never before launch). Used by the schedule view. */
export async function freeSlotsInRange(
  productId: string,
  from: Date,
  to: Date,
  tx: DbOrTx = db,
): Promise<SlotCandidate[]> {
  const settings = await ensureSettingsRow(productId, tx);
  const start = earliestSlotTime(
    new Date(Math.max(from.getTime(), Date.now())),
    settings.launchDate,
    settings.timezone,
  );
  if (start.getTime() >= to.getTime()) return [];
  const rules = await loadSlotRules(productId, PLATFORMS, tx);
  if (rules.length === 0) return [];
  const taken = await loadTakenPosts(productId, PLATFORMS, start, to, tx);
  return removeTaken(expandSlots(rules, start, to), taken);
}

/* ---------- Product channels ---------- */

export async function listProductChannels(productId: string): Promise<ProductChannelView[]> {
  await getProductOr404(productId);
  const rows = await db
    .select({ account: channelAccounts, link: productChannels })
    .from(channelAccounts)
    .leftJoin(
      productChannels,
      and(
        eq(productChannels.channelAccountId, channelAccounts.id),
        eq(productChannels.productId, productId),
      ),
    )
    .where(or(isNull(channelAccounts.productId), eq(channelAccounts.productId, productId)))
    .orderBy(
      sql`array_position(array['instagram','youtube','facebook','linkedin','whatsapp']::text[], ${channelAccounts.platform}::text)`,
      asc(channelAccounts.displayName),
    );
  return rows.map(({ account, link }) => ({
    channelAccountId: account.id,
    platform: account.platform,
    displayName: account.displayName,
    handle: account.handle,
    status: account.status,
    shared: account.productId === null,
    enabled: link?.enabled ?? false,
    defaultLanguages: link?.defaultLanguages ?? [],
    defaultRatio: link?.defaultRatio ?? null,
    configured: link !== null,
  }));
}

export async function replaceProductChannels(
  productId: string,
  channels: ProductChannelInput[],
  ctx: AuditCtx,
): Promise<ProductChannelView[]> {
  await db.transaction(async (tx) => {
    await getProductOr404(productId, tx);
    const ids = channels.map((c) => c.channelAccountId);
    if (ids.length > 0) {
      const allowed = await tx
        .select({ id: channelAccounts.id })
        .from(channelAccounts)
        .where(
          and(
            inArray(channelAccounts.id, ids),
            or(isNull(channelAccounts.productId), eq(channelAccounts.productId, productId)),
          ),
        );
      const ok = new Set(allowed.map((a) => a.id));
      const bad = channels.findIndex((c) => !ok.has(c.channelAccountId));
      if (bad >= 0) {
        throw badRequest(
          'This channel account cannot be used by this product.',
          'VALIDATION_FAILED',
          [
            {
              path: `channels.${bad}.channelAccountId`,
              message: 'Unknown channel account for this product',
            },
          ],
        );
      }
    }
    const before = await tx
      .select()
      .from(productChannels)
      .where(eq(productChannels.productId, productId));
    await tx.delete(productChannels).where(eq(productChannels.productId, productId));
    if (channels.length > 0) {
      await tx.insert(productChannels).values(
        channels.map((c) => ({
          productId,
          channelAccountId: c.channelAccountId,
          enabled: c.enabled,
          defaultLanguages: c.defaultLanguages,
          defaultRatio: c.defaultRatio,
        })),
      );
    }
    await writeAudit(
      {
        ...ctx,
        action: 'channels.replace',
        entity: 'product_channels',
        entityId: productId,
        before: before.map(({ createdAt: _c, updatedAt: _u, ...rest }) => rest),
        after: channels,
      },
      tx,
    );
  });
  return listProductChannels(productId);
}

/* ---------- Schedule view ---------- */

export async function getSchedule(
  productId: string,
  from: Date,
  to: Date,
): Promise<ScheduleResponse> {
  const settings = await ensureSettingsRow(productId);
  const at = sql<Date>`coalesce(${posts.publishedAt}, ${posts.scheduledAt})`;
  const rows = await db
    .select({
      postId: posts.id,
      briefId: briefs.id,
      briefCode: briefs.code,
      briefTitle: briefs.title,
      platform: channelAccounts.platform,
      channelName: channelAccounts.displayName,
      status: posts.status,
      scheduledAt: posts.scheduledAt,
      publishedAt: posts.publishedAt,
      audienceTz: posts.audienceTz,
      liveUrl: posts.liveUrl,
    })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(
      and(
        eq(briefs.productId, productId),
        inArray(posts.status, ['scheduled', 'publishing', 'published', 'failed', 'manual_pending']),
        gte(at, from),
        lt(at, to),
      ),
    )
    .orderBy(asc(at));
  const items: ScheduleItem[] = rows.flatMap((r) => {
    const when = r.publishedAt ?? r.scheduledAt;
    if (!when) return [];
    return [
      {
        postId: r.postId,
        briefId: r.briefId,
        briefCode: r.briefCode,
        briefTitle: r.briefTitle,
        platform: r.platform,
        channelName: r.channelName,
        status: r.status,
        at: when.toISOString(),
        audienceTimezone: r.audienceTz,
        liveUrl: r.liveUrl,
      },
    ];
  });
  const free = await freeSlotsInRange(productId, from, to);
  return {
    items,
    freeSlots: free.map(toNextSlotDto),
    timezone: settings.timezone,
    launchDate: settings.launchDate,
  };
}
