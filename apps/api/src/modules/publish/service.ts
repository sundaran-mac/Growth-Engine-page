/**
 * Publish module service: channel accounts and OAuth connect, the publish queue, posts
 * (edit, schedule all, post now, retry, cancel, mark posted) and the worker side
 * (publish one post with the fail-safe rule, WhatsApp reminders, token refresh).
 */
import { and, asc, eq, inArray, lte, min, ne, or, sql } from 'drizzle-orm';
import {
  type BriefStage,
  type ContentMode,
  type ListResponse,
  type MarkPostedRequest,
  type OAuthCallbackQuery,
  type OAuthPlatform,
  OAUTH_PLATFORM_LABELS,
  type Platform,
  PLATFORM_LABELS,
  type PostMediaUrl,
  type PostStatus,
  type PostStatusCounts,
  type PostView,
  PUBLISH_HOW_LABELS,
  type PublishBriefSummary,
  type PublishQueueItem,
  type PublishQueueQuery,
  type ScheduleAllResponse,
  type TrackedLink,
  type UpdatePostRequest,
} from '@growth-desk/contract';
import {
  type AccountCredentials,
  type ConnectorErrorCode,
  getConnector,
  getOAuthProvider,
  isConnectorError,
  providerForPlatform,
  type PublishMedia,
} from '../../connectors/index.js';
import type { Connector } from '../../connectors/types.js';
import { env } from '../../config/env.js';
import { db, type DbOrTx } from '../../db/client.js';
import { assets, briefs, channelAccounts, notifications, posts, users } from '../../db/schema/index.js';
import { type AuditEntry, writeAudit } from '../../lib/audit.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { type AppError, badRequest, conflict, featureDisabled, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notifyMany } from '../../lib/notifications.js';
import { remember } from '../../lib/content-memory.js';
import { presignGet } from '../../lib/storage.js';
import { formatWhen } from '../../lib/time.js';
import { postPublishJob, whatsappReminderJob } from './jobs.js';
import { codeChallengeS256, createCodeVerifier, createOAuthState, verifyOAuthState } from './oauth-state.js';
import {
  type ChannelAccountRow,
  getBrief,
  getChannelAccount,
  getPostContext,
  getPostView,
  getProduct,
  getPublishSettings,
  howOf,
  listPostViews,
  loadGate,
  loadLearnedWindows,
  type PostContext,
  toChannelAccountView,
} from './repo.js';
import { learnedKey, learnedWindowTimes, windowLabel, type LearnedWindow } from './best-window.js';
import { BEST_WINDOW_TEXT, buildTrackedLink, formatLine, nextBestWindow } from './rules.js';

export type AuditCtx = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;

/** Minimum gap between now and a time a person picks for a scheduled post. */
const MIN_SCHEDULE_AHEAD_MS = 60_000;
/** Presigned GET lifetime handed to platforms that download the file (processing can be slow). */
const PLATFORM_MEDIA_TTL = 60 * 60;

const EDITABLE: readonly PostStatus[] = ['draft', 'scheduled', 'failed', 'manual_pending'];

/* ---------- Errors ---------- */

export function gateNotAllowed(reason: string | null): AppError {
  return unprocessable(reason ?? 'Both gates must approve the current version first.', 'GATE_NOT_ALLOWED');
}

function notEditable(status: PostStatus): AppError {
  return conflict(`This post is ${status.replace('_', ' ')} and cannot be changed now.`, 'POST_NOT_EDITABLE');
}

/* ---------- Brief stage helpers ---------- */

async function setBriefStage(tx: DbOrTx, briefId: string, from: readonly BriefStage[], to: BriefStage): Promise<boolean> {
  const rows = await tx
    .update(briefs)
    .set({ stage: to })
    .where(and(eq(briefs.id, briefId), inArray(briefs.stage, [...from])))
    .returning({ id: briefs.id });
  return rows.length > 0;
}

async function enqueuePublish(postId: string): Promise<void> {
  try {
    await postPublishJob.send({ postId }, { singletonKey: `post-${postId}` });
  } catch (err) {
    // The sweep job picks up due posts every minute, so a queue hiccup only delays the post.
    logger.warn({ err, postId }, 'could not queue post.publish now; the sweep will pick it up');
  }
}

/* ---------- Channel accounts ---------- */

export async function disconnectChannelAccount(id: string, ctx: AuditCtx): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getChannelAccount(id, tx);
    if (!before) throw notFound('Channel account');
    const [after] = await tx
      .update(channelAccounts)
      .set({
        status: 'disconnected',
        accessTokenEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
        allowedActions: [],
        lastError: null,
      })
      .where(eq(channelAccounts.id, id))
      .returning();
    await writeAudit(
      {
        ...ctx,
        action: 'channel.disconnect',
        entity: 'channel_account',
        entityId: id,
        before: toChannelAccountView(before),
        after: after ? toChannelAccountView(after) : null,
      },
      tx,
    );
  });
}

/* ---------- OAuth connect ---------- */

export function redirectUriFor(platform: OAuthPlatform): string {
  return `${env.oauthRedirectBaseUrl}/api/v1/integrations/oauth/${platform}/callback`;
}

export function startOAuth(platform: OAuthPlatform, userId: string, productId: string | null): { url: string } {
  const provider = getOAuthProvider(platform);
  if (!provider.isConfigured()) throw featureDisabled(OAUTH_PLATFORM_LABELS[platform]);
  const verifier = provider.supportsPkce ? createCodeVerifier() : null;
  const state = createOAuthState({ platform, userId, productId, codeVerifier: verifier });
  return {
    url: provider.buildAuthUrl({
      state,
      redirectUri: redirectUriFor(platform),
      codeChallenge: verifier ? codeChallengeS256(verifier) : null,
    }),
  };
}

function webIntegrationsUrl(params: Record<string, string>): string {
  const base = env.webOrigins[0] ?? 'http://localhost:5173';
  return `${base}/integrations?${new URLSearchParams(params).toString()}`;
}

/** Short text the Integrations page shows for each failure code. */
const OAUTH_FAIL_TEXT: Record<string, string> = {
  OAUTH_STATE_INVALID: 'The sign-in link expired or is not valid. Press Connect again.',
  OAUTH_DENIED: 'Permission was not given on the platform.',
  OAUTH_EXCHANGE_FAILED: 'The platform did not accept the sign-in. Try again.',
  OAUTH_NO_ACCOUNTS: 'No pages or channels were found for this login.',
  FORBIDDEN: 'Only an admin or editor can connect channels.',
  FEATURE_DISABLED: 'This platform is not set up: add its keys in .env.',
  PLATFORM_AUTH_FAILED: 'The platform refused the token. Try again.',
  PLATFORM_RATE_LIMITED: 'The platform is busy. Try again in a few minutes.',
  PLATFORM_TIMEOUT: 'The platform did not answer in time. Try again.',
  PLATFORM_ERROR: 'The platform sent an error. Try again.',
};

/** Handles the provider redirect. Always returns where to send the browser; never throws. */
export async function handleOAuthCallback(
  platform: OAuthPlatform,
  query: OAuthCallbackQuery,
  sessionUserId: string | null,
  ctx: Omit<AuditCtx, 'actorId'>,
): Promise<string> {
  const fail = (code: string) => webIntegrationsUrl({ error: code, message: OAUTH_FAIL_TEXT[code] ?? 'The connection did not finish. Try again.' });
  if (!query.state) return fail('OAUTH_STATE_INVALID');
  const check = verifyOAuthState(query.state, platform);
  if (!check.ok) {
    logger.warn({ platform, reason: check.reason }, 'oauth state rejected');
    return fail('OAUTH_STATE_INVALID');
  }
  const { userId, productId, codeVerifier } = check.payload;
  // A browser signed in as someone else must not finish another person's connect.
  if (sessionUserId && sessionUserId !== userId) return fail('OAUTH_STATE_INVALID');

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.isActive || !(user.role === 'admin' || user.role === 'editor')) return fail('FORBIDDEN');

  const audit = { ...ctx, actorId: userId };
  if (query.error) {
    await writeAudit({ ...audit, action: 'channel.connect_denied', entity: 'oauth', entityId: platform, after: { error: query.error } });
    return fail('OAUTH_DENIED');
  }
  if (!query.code) return fail('OAUTH_STATE_INVALID');

  const provider = getOAuthProvider(platform);
  if (!provider.isConfigured()) return fail('FEATURE_DISABLED');

  let discovered;
  try {
    const tokens = await provider.exchangeCode({ code: query.code, redirectUri: redirectUriFor(platform), codeVerifier });
    discovered = await provider.discoverAccounts(tokens);
  } catch (err) {
    logger.warn({ err, platform }, 'oauth connect failed');
    return fail(isConnectorError(err) ? err.code : 'OAUTH_EXCHANGE_FAILED');
  }
  if (discovered.length === 0) return fail('OAUTH_NO_ACCOUNTS');

  await db.transaction(async (tx) => {
    for (const acc of discovered) {
      const values = {
        displayName: acc.displayName,
        handle: acc.handle,
        description: acc.description,
        status: acc.status,
        allowedActions: acc.allowedActions,
        accessTokenEnc: encryptSecret(acc.accessToken),
        refreshTokenEnc: acc.refreshToken ? encryptSecret(acc.refreshToken) : null,
        expiresAt: acc.expiresAt,
        lastError: null,
        connectedById: userId,
        connectedAt: new Date(),
      };
      const [existing] = await tx
        .select()
        .from(channelAccounts)
        .where(and(eq(channelAccounts.platform, acc.platform), eq(channelAccounts.externalAccountId, acc.externalAccountId)))
        .limit(1);
      // A placeholder row (no account id, no token, for example from the seed) is taken over.
      const [placeholder] = existing
        ? [undefined]
        : await tx
            .select()
            .from(channelAccounts)
            .where(
              and(
                eq(channelAccounts.platform, acc.platform),
                sql`${channelAccounts.externalAccountId} is null`,
                sql`${channelAccounts.accessTokenEnc} is null`,
              ),
            )
            .orderBy(asc(channelAccounts.createdAt))
            .limit(1);
      const target = existing ?? placeholder;
      let row: ChannelAccountRow | undefined;
      if (target) {
        [row] = await tx
          .update(channelAccounts)
          .set({ ...values, externalAccountId: acc.externalAccountId, ...(productId ? { productId } : {}) })
          .where(eq(channelAccounts.id, target.id))
          .returning();
      } else {
        [row] = await tx
          .insert(channelAccounts)
          .values({ ...values, platform: acc.platform, externalAccountId: acc.externalAccountId, productId })
          .returning();
      }
      if (row) {
        await writeAudit(
          {
            ...audit,
            action: 'channel.connect',
            entity: 'channel_account',
            entityId: row.id,
            before: target ? toChannelAccountView(target) : null,
            after: toChannelAccountView(row),
          },
          tx,
        );
      }
    }
  });
  return webIntegrationsUrl({ connected: platform });
}

/* ---------- Publish queue and summary ---------- */

const QUEUE_STAGES: readonly BriefStage[] = ['approved', 'scheduled', 'live'];

function emptyCounts(): PostStatusCounts {
  return { draft: 0, scheduled: 0, publishing: 0, published: 0, failed: 0, manual_pending: 0 };
}

export async function listPublishQueue(q: PublishQueueQuery): Promise<ListResponse<PublishQueueItem>> {
  const stages = q.stage ? [q.stage] : [...QUEUE_STAGES];
  const where = and(eq(briefs.productId, q.productId), inArray(briefs.stage, stages));
  const [rows, totals] = await Promise.all([
    db.select().from(briefs).where(where).orderBy(sql`${briefs.updatedAt} desc`).limit(q.limit).offset(q.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(briefs).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, PostStatusCounts>();
  const next = new Map<string, Date | null>();
  if (ids.length > 0) {
    const grouped = await db
      .select({ briefId: posts.briefId, status: posts.status, n: sql<number>`count(*)::int` })
      .from(posts)
      .where(inArray(posts.briefId, ids))
      .groupBy(posts.briefId, posts.status);
    for (const g of grouped) {
      const c = counts.get(g.briefId) ?? emptyCounts();
      c[g.status] = g.n;
      counts.set(g.briefId, c);
    }
    const nextRows = await db
      .select({ briefId: posts.briefId, at: min(posts.scheduledAt) })
      .from(posts)
      .where(and(inArray(posts.briefId, ids), inArray(posts.status, ['scheduled', 'manual_pending'])))
      .groupBy(posts.briefId);
    for (const n of nextRows) next.set(n.briefId, n.at);
  }
  return {
    total: totals[0]?.n ?? 0,
    items: rows.map((b) => ({
      briefId: b.id,
      productId: b.productId,
      code: b.code,
      title: b.title,
      kind: b.kind,
      mode: b.mode,
      stage: b.stage,
      version: b.version,
      channels: b.channels,
      counts: counts.get(b.id) ?? emptyCounts(),
      nextScheduledAt: next.get(b.id)?.toISOString() ?? null,
      updatedAt: b.updatedAt.toISOString(),
    })),
  };
}

export async function getPublishSummary(briefId: string): Promise<PublishBriefSummary> {
  const brief = await getBrief(briefId);
  if (!brief) throw notFound('Brief');
  const [gate, settings, learned] = await Promise.all([
    loadGate(brief),
    getPublishSettings(brief.productId),
    loadLearnedWindows(brief.productId),
  ]);
  const bestWindow = describeBestWindows(brief.channels, settings.timezone, learned);
  return {
    brief: {
      id: brief.id,
      productId: brief.productId,
      code: brief.code,
      title: brief.title,
      kind: brief.kind,
      mode: brief.mode,
      stage: brief.stage,
      version: brief.version,
      channels: brief.channels,
    },
    gate,
    autoSchedule: settings.autoSchedule,
    timezone: settings.timezone,
    launchDate: settings.launchDate,
    bestWindow,
  };
}

/**
 * Best window per channel of the brief in the product's audience zone: "learned" when that
 * platform has 4 weeks of measured posts, else "starting". Pure.
 */
export function describeBestWindows(
  platforms: readonly Platform[],
  timeZone: string,
  learned: ReadonlyMap<string, LearnedWindow>,
): PublishBriefSummary['bestWindow'] {
  const windows = [...new Set(platforms)].map((platform) => {
    const w = learned.get(learnedKey(platform, timeZone));
    return w
      ? {
          platform,
          audienceTz: timeZone,
          rule: 'learned' as const,
          startHour: w.startHour,
          endHour: w.endHour,
          valuePer1kReach: w.valuePer1kReach,
          posts: w.posts,
        }
      : { platform, audienceTz: timeZone, rule: 'starting' as const, startHour: null, endHour: null, valuePer1kReach: null, posts: 0 };
  });
  const learnedOnes = windows.filter((w) => w.rule === 'learned');
  if (learnedOnes.length === 0) return { rule: 'starting', text: BEST_WINDOW_TEXT, windows };
  const parts = learnedOnes.map(
    (w) =>
      `${PLATFORM_LABELS[w.platform]} ${windowLabel({ startHour: w.startHour!, endHour: w.endHour! })} (${w.valuePer1kReach} value per 1k reach)`,
  );
  const starting = windows.filter((w) => w.rule === 'starting').map((w) => PLATFORM_LABELS[w.platform]);
  const text =
    `Learned from your own posts, ${timeZone} time: ${parts.join('; ')}.` +
    (starting.length > 0 ? ` Still on the starting rule (6 to 9 am or 7 to 10 pm): ${starting.join(', ')}.` : '');
  return { rule: 'learned', text, windows };
}

/** Posts of the current brief version, plus anything already published from older versions. */
export async function listBriefPosts(briefId: string, tx: DbOrTx = db): Promise<ListResponse<PostView>> {
  const brief = await getBrief(briefId, tx);
  if (!brief) throw notFound('Brief');
  const items = await listPostViews(
    and(eq(posts.briefId, briefId), or(eq(posts.briefVersion, brief.version), eq(posts.status, 'published')))!,
    tx,
  );
  return { items, total: items.length };
}

/* ---------- Edit and actions on posts ---------- */

async function requirePostContext(postId: string, tx: DbOrTx = db): Promise<PostContext> {
  const ctx = await getPostContext(postId, tx);
  if (!ctx) throw notFound('Post');
  return ctx;
}

async function postViewOrThrow(postId: string, tx: DbOrTx = db): Promise<PostView> {
  const view = await getPostView(postId, tx);
  if (!view) throw notFound('Post');
  return view;
}

export async function updatePost(postId: string, body: UpdatePostRequest, actx: AuditCtx): Promise<PostView> {
  return db.transaction(async (tx) => {
    const ctx = await requirePostContext(postId, tx);
    const { post } = ctx;
    if (!EDITABLE.includes(post.status)) throw notEditable(post.status);
    const set: Partial<typeof posts.$inferInsert> = {};
    if (body.caption !== undefined) set.caption = body.caption;
    if (body.languages !== undefined) set.languages = [...new Set(body.languages)];
    if (body.audienceTz !== undefined) set.audienceTz = body.audienceTz;
    if (body.scheduledAt !== undefined) {
      if (body.scheduledAt === null) {
        if (post.status === 'scheduled' || post.status === 'manual_pending') {
          throw badRequest('A scheduled post needs a time. Cancel it first to clear the time.');
        }
        set.scheduledAt = null;
      } else {
        const at = new Date(body.scheduledAt);
        if ((post.status === 'scheduled' || post.status === 'manual_pending') && at.getTime() < Date.now() + MIN_SCHEDULE_AHEAD_MS) {
          throw badRequest('Pick a time at least one minute from now.', 'VALIDATION_FAILED', [
            { path: 'body.scheduledAt', message: 'Must be in the future' },
          ]);
        }
        set.scheduledAt = at;
      }
    }
    if (body.assetId !== undefined) {
      if (body.assetId === null) {
        set.assetId = null;
        set.format = null;
      } else {
        const [asset] = await tx
          .select()
          .from(assets)
          .where(and(eq(assets.id, body.assetId), eq(assets.briefId, post.briefId), eq(assets.status, 'ready')))
          .limit(1);
        if (!asset) {
          throw badRequest('Pick a ready file of this brief.', 'VALIDATION_FAILED', [
            { path: 'body.assetId', message: 'Not a ready asset of this brief' },
          ]);
        }
        set.assetId = asset.id;
        set.format = formatLine((asset.ratio as never) ?? null, asset.durationMs);
      }
    }
    const [after] = await tx.update(posts).set(set).where(eq(posts.id, postId)).returning();
    await writeAudit({ ...actx, action: 'post.update', entity: 'post', entityId: postId, before: post, after }, tx);
    return postViewOrThrow(postId, tx);
  });
}

/** Times already taken on a channel (scheduled or reminder posts), to avoid double booking. */
async function takenTimes(tx: DbOrTx, channelAccountId: string, exceptPostId: string): Promise<Date[]> {
  const rows = await tx
    .select({ at: posts.scheduledAt })
    .from(posts)
    .where(
      and(
        eq(posts.channelAccountId, channelAccountId),
        ne(posts.id, exceptPostId),
        inArray(posts.status, ['scheduled', 'manual_pending', 'publishing']),
      ),
    );
  return rows.map((r) => r.at).filter((d): d is Date => d !== null);
}

export async function scheduleAll(briefId: string, actx: AuditCtx): Promise<ScheduleAllResponse> {
  return db.transaction(async (tx) => {
    const brief = await getBrief(briefId, tx);
    if (!brief) throw notFound('Brief');
    const gate = await loadGate(brief, tx);
    if (!gate.allowed) throw gateNotAllowed(gate.reason);
    const settings = await getPublishSettings(brief.productId, tx);
    const rows = await tx
      .select({ post: posts, channel: channelAccounts })
      .from(posts)
      .innerJoin(channelAccounts, eq(posts.channelAccountId, channelAccounts.id))
      .where(and(eq(posts.briefId, briefId), eq(posts.briefVersion, brief.version), eq(posts.status, 'draft')))
      .for('update', { of: posts });

    const now = new Date();
    const learned = rows.length > 0 ? await loadLearnedWindows(brief.productId, tx, now) : new Map<string, LearnedWindow>();
    let scheduled = 0;
    const skipped: ScheduleAllResponse['skipped'] = [];
    const changed: { id: string; status: PostStatus; at: string }[] = [];
    for (const { post, channel } of rows) {
      const how = howOf(channel, now);
      if (how !== 'auto' && how !== 'reminder') {
        skipped.push({ postId: post.id, reason: PUBLISH_HOW_LABELS[how] });
        continue;
      }
      let at = post.scheduledAt;
      if (!at || at.getTime() < now.getTime() + MIN_SCHEDULE_AHEAD_MS) {
        const win = learned.get(learnedKey(channel.platform, post.audienceTz));
        at = nextBestWindow({
          from: now,
          timeZone: post.audienceTz,
          launchDate: settings.launchDate,
          taken: await takenTimes(tx, channel.id, post.id),
          ...(win ? { times: learnedWindowTimes(win) } : {}),
        });
      }
      const status: PostStatus = how === 'auto' ? 'scheduled' : 'manual_pending';
      await tx.update(posts).set({ status, scheduledAt: at, error: null }).where(eq(posts.id, post.id));
      changed.push({ id: post.id, status, at: at.toISOString() });
      scheduled += 1;
    }
    if (scheduled > 0) await setBriefStage(tx, briefId, ['approved'], 'scheduled');
    await writeAudit(
      { ...actx, action: 'post.schedule_all', entity: 'brief', entityId: briefId, after: { changed, skipped } },
      tx,
    );
    const items = (await listBriefPosts(briefId, tx)).items;
    return { scheduled, skipped, items };
  });
}

function howError(how: ReturnType<typeof howOf>): AppError {
  if (how === 'needs_approval') {
    return unprocessable('This channel is waiting for platform approval. It cannot post by API yet.', 'NEEDS_APPROVAL');
  }
  if (how === 'reminder') {
    return unprocessable('This channel is posted by hand. Use the reminder and "Mark as posted".', 'NOT_CONNECTED');
  }
  return unprocessable('This channel is not connected. Connect it on Integrations first.', 'NOT_CONNECTED');
}

async function queueNow(postId: string, allowed: readonly PostStatus[], action: string, actx: AuditCtx): Promise<PostView> {
  const view = await db.transaction(async (tx) => {
    const ctx = await requirePostContext(postId, tx);
    const { post, brief, channel } = ctx;
    if (!allowed.includes(post.status)) throw notEditable(post.status);
    const gate = await loadGate(brief, tx);
    if (!gate.allowed) throw gateNotAllowed(gate.reason);
    if (post.briefVersion !== brief.version) {
      throw gateNotAllowed(`This post was made for version ${post.briefVersion}; the brief is now at version ${brief.version}.`);
    }
    const how = howOf(channel);
    if (how !== 'auto') throw howError(how);
    const [after] = await tx
      .update(posts)
      .set({ status: 'scheduled', scheduledAt: new Date(), error: null })
      .where(eq(posts.id, postId))
      .returning();
    await setBriefStage(tx, brief.id, ['approved'], 'scheduled');
    await writeAudit({ ...actx, action, entity: 'post', entityId: postId, before: post, after }, tx);
    return postViewOrThrow(postId, tx);
  });
  await enqueuePublish(postId);
  return view;
}

export function postNow(postId: string, actx: AuditCtx): Promise<PostView> {
  return queueNow(postId, ['draft', 'scheduled'], 'post.post_now', actx);
}

export function retryPost(postId: string, actx: AuditCtx): Promise<PostView> {
  return queueNow(postId, ['failed'], 'post.retry', actx);
}

export async function cancelPost(postId: string, actx: AuditCtx): Promise<PostView> {
  return db.transaction(async (tx) => {
    const ctx = await requirePostContext(postId, tx);
    const { post, brief } = ctx;
    if (post.status !== 'scheduled' && post.status !== 'manual_pending') throw notEditable(post.status);
    const [after] = await tx.update(posts).set({ status: 'draft' }).where(eq(posts.id, postId)).returning();
    // Nothing left going out or gone out: the brief goes back to approved.
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(posts)
      .where(and(eq(posts.briefId, brief.id), inArray(posts.status, ['scheduled', 'manual_pending', 'publishing', 'published'])));
    if ((left?.n ?? 0) === 0) await setBriefStage(tx, brief.id, ['scheduled'], 'approved');
    await writeAudit({ ...actx, action: 'post.cancel', entity: 'post', entityId: postId, before: post, after }, tx);
    return postViewOrThrow(postId, tx);
  });
}

export async function markPosted(postId: string, body: MarkPostedRequest, actx: AuditCtx): Promise<PostView> {
  return db.transaction(async (tx) => {
    const ctx = await requirePostContext(postId, tx);
    const { post, brief } = ctx;
    if (post.status !== 'manual_pending') throw notEditable(post.status);
    const [after] = await tx
      .update(posts)
      .set({ status: 'published', publishedAt: new Date(), liveUrl: body.liveUrl ?? post.liveUrl, error: null })
      .where(eq(posts.id, postId))
      .returning();
    await setBriefStage(tx, brief.id, ['approved', 'scheduled'], 'live');
    await rememberCaption(tx, after!, brief);
    await writeAudit({ ...actx, action: 'post.mark_posted', entity: 'post', entityId: postId, before: post, after }, tx);
    return postViewOrThrow(postId, tx);
  });
}

export async function getTrackedLinkForPost(postId: string): Promise<TrackedLink> {
  const ctx = await requirePostContext(postId);
  const { post, brief, channel } = ctx;
  if (post.trackedUrl) {
    const u = new URL(post.trackedUrl);
    const p = (k: string) => u.searchParams.get(k) ?? '';
    return {
      url: post.trackedUrl,
      display: post.trackedUrl.replace(/^https?:\/\//i, ''),
      params: { utm_source: p('utm_source'), utm_medium: p('utm_medium'), utm_campaign: p('utm_campaign'), utm_content: p('utm_content') },
    };
  }
  const settings = await getPublishSettings(brief.productId);
  const product = await getProduct(brief.productId);
  return buildTrackedLink({
    baseUrl: settings.trackingBaseUrl ?? env.trackingLinkBase,
    campaignPrefix: settings.utmCampaignPrefix ?? product?.slug ?? 'humini',
    platform: channel.platform,
    kind: brief.kind,
    mode: brief.mode,
    briefCode: brief.code,
    when: post.scheduledAt ?? new Date(),
    timeZone: post.audienceTz,
  });
}

export async function getPostMediaUrl(postId: string): Promise<PostMediaUrl> {
  const { asset } = await requirePostContext(postId);
  if (!asset || asset.status !== 'ready') throw unprocessable('This post has no ready file yet.', 'NO_MEDIA');
  return presignGet({ key: asset.storageKey, downloadName: asset.fileName ?? asset.storageKey.split('/').pop() ?? 'file' });
}

/* ---------- Worker: publish one post (fail-safe) ---------- */

type FailCode = ConnectorErrorCode | 'GATE_NOT_ALLOWED';

class PublishFailure extends Error {
  constructor(
    readonly code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

/** Media for a platform: presigned GET; platforms that download from a URL need public storage. */
export async function resolveMedia(ctx: PostContext, connector: Connector): Promise<PublishMedia> {
  const { asset } = ctx;
  if (!asset || asset.status !== 'ready') throw new PublishFailure('NO_MEDIA', 'This post has no ready file.');
  const kind = asset.kind === 'poster' ? 'image' : 'video';
  if ((kind === 'video' && !connector.capabilities.video) || (kind === 'image' && !connector.capabilities.image)) {
    throw new PublishFailure('UNSUPPORTED_FORMAT', `${connector.platform} does not take this kind of file (${kind}).`);
  }
  if (!env.storage) throw new PublishFailure('NO_MEDIA', 'File storage is not set up.');
  if (connector.capabilities.mediaTransfer === 'pull_url' && env.storage.driver === 'minio') {
    throw new PublishFailure(
      'MEDIA_NOT_PUBLIC',
      'The platform downloads the file from a public URL, and local MinIO is not public. Use R2 (STORAGE_DRIVER=r2) to post for real.',
    );
  }
  const { url } = await presignGet({ key: asset.storageKey, expiresIn: PLATFORM_MEDIA_TTL });
  return {
    kind,
    url,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    durationMs: asset.durationMs,
    ratio: (asset.ratio as PublishMedia['ratio']) ?? null,
    fileName: asset.fileName,
  };
}

/** Decrypts the token and renews it first when it is about to expire and can be refreshed. */
export async function loadCredentials(channel: ChannelAccountRow): Promise<AccountCredentials> {
  if (!channel.accessTokenEnc || !channel.externalAccountId) {
    throw new PublishFailure('NOT_CONNECTED', 'This channel has no token. Connect it on Integrations.');
  }
  let accessToken = decryptSecret(channel.accessTokenEnc);
  const soon = channel.expiresAt !== null && channel.expiresAt.getTime() - Date.now() < 5 * 60_000;
  if (soon) {
    const provider = providerForPlatform(channel.platform);
    if (channel.refreshTokenEnc && provider?.refresh) {
      try {
        const tokens = await provider.refresh(decryptSecret(channel.refreshTokenEnc));
        accessToken = tokens.accessToken;
        await db
          .update(channelAccounts)
          .set({
            accessTokenEnc: encryptSecret(tokens.accessToken),
            refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : channel.refreshTokenEnc,
            expiresAt: tokens.expiresAt,
          })
          .where(eq(channelAccounts.id, channel.id));
      } catch (err) {
        throw new PublishFailure('PLATFORM_AUTH_FAILED', `Could not renew the ${channel.platform} token. Reconnect the channel. ${err instanceof Error ? err.message : ''}`.trim());
      }
    } else if (channel.expiresAt && channel.expiresAt.getTime() <= Date.now()) {
      throw new PublishFailure('NOT_CONNECTED', 'The channel token has expired. Reconnect it on Integrations.');
    }
  }
  return { externalAccountId: channel.externalAccountId, accessToken, allowedActions: channel.allowedActions };
}

async function ownersOf(tx: DbOrTx, brief: { ownerId: string | null; productId: string }): Promise<string[]> {
  const product = await getProduct(brief.productId, tx);
  return [brief.ownerId, product?.ownerId, product?.backupId].filter((v): v is string => Boolean(v));
}

export type PublishOutcome = 'published' | 'failed' | 'skipped';

/**
 * Publishes one due post. Claims it atomically (scheduled -> publishing), so two workers never
 * post twice. Any failure follows the fail-safe rule; nothing is retried silently.
 */
export async function publishPost(postId: string): Promise<PublishOutcome> {
  const [claimed] = await db
    .update(posts)
    .set({ status: 'publishing', attempts: sql`${posts.attempts} + 1`, error: null })
    .where(and(eq(posts.id, postId), eq(posts.status, 'scheduled'), lte(posts.scheduledAt, new Date())))
    .returning({ id: posts.id });
  if (!claimed) return 'skipped';

  const ctx = await requirePostContext(postId);
  try {
    const gate = await loadGate(ctx.brief);
    if (!gate.allowed) throw new PublishFailure('GATE_NOT_ALLOWED', gate.reason ?? 'Both gates must approve first.');
    if (ctx.post.briefVersion !== ctx.brief.version) {
      throw new PublishFailure('GATE_NOT_ALLOWED', `This post is for version ${ctx.post.briefVersion}; the brief is now at version ${ctx.brief.version}.`);
    }
    const how = howOf(ctx.channel);
    if (how === 'needs_approval') throw new PublishFailure('NEEDS_APPROVAL', 'The channel is waiting for platform approval.');
    if (how !== 'auto') throw new PublishFailure('NOT_CONNECTED', 'The channel is not connected.');
    const connector = getConnector(ctx.channel.platform);
    if (!connector.capabilities.publish) throw new PublishFailure('UNSUPPORTED_FORMAT', 'This channel is posted by hand.');
    const media = await resolveMedia(ctx, connector);
    const account = await loadCredentials(ctx.channel);
    const result = await connector.publish({ account, media, caption: ctx.post.caption ?? '', title: ctx.brief.title });
    await markPublished(ctx, result.externalId, result.liveUrl);
    return 'published';
  } catch (err) {
    const code: FailCode = err instanceof PublishFailure || isConnectorError(err) ? err.code : 'PLATFORM_ERROR';
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (!(err instanceof PublishFailure) && !isConnectorError(err)) logger.error({ err, postId }, 'publish crashed');
    await markFailed(ctx, code, message);
    return 'failed';
  }
}

/**
 * A published caption goes into the content memory (ADR 0009). Captions are never blocked: a
 * reel and a reminder of one brief share text. Publish asks POST /memory/check (kind
 * post_caption, excludeBriefId) to flag a near-identical caption of ANOTHER brief.
 */
async function rememberCaption(
  tx: DbOrTx,
  post: { id: string; caption: string | null },
  brief: { productId: string; title: string; mode: ContentMode },
): Promise<void> {
  if (!post.caption?.trim()) return;
  await remember(
    { sourceType: 'post_caption', sourceId: post.id, productId: brief.productId, title: brief.title, body: post.caption, mode: brief.mode },
    tx,
  );
}

async function markPublished(ctx: PostContext, externalId: string, liveUrl: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(posts)
      .set({ status: 'published', externalId, liveUrl, publishedAt: new Date(), error: null })
      .where(eq(posts.id, ctx.post.id))
      .returning();
    await tx
      .update(channelAccounts)
      .set({ status: sql`case when ${channelAccounts.status} = 'error' then 'connected'::channel_status else ${channelAccounts.status} end`, lastError: null })
      .where(eq(channelAccounts.id, ctx.channel.id));
    // Brief becomes live when its first post publishes.
    await setBriefStage(tx, ctx.brief.id, ['approved', 'scheduled'], 'live');
    await rememberCaption(tx, after!, ctx.brief);
    await writeAudit({ actorId: null, action: 'post.publish', entity: 'post', entityId: ctx.post.id, before: ctx.post, after }, tx);
  });
}

const CHANNEL_ERROR_CODES: readonly FailCode[] = [
  'PLATFORM_AUTH_FAILED',
  'PLATFORM_RATE_LIMITED',
  'PLATFORM_TIMEOUT',
  'PLATFORM_ERROR',
];

async function markFailed(ctx: PostContext, code: FailCode, message: string): Promise<void> {
  const errorText = `${code}: ${message}`.slice(0, 2000);
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(posts)
      .set({ status: 'failed', error: errorText })
      .where(eq(posts.id, ctx.post.id))
      .returning();
    // The channel is marked: platform errors set it to `error`; other causes only note the error.
    await tx
      .update(channelAccounts)
      .set({ lastError: errorText, ...(CHANNEL_ERROR_CODES.includes(code) ? { status: 'error' as const } : {}) })
      .where(eq(channelAccounts.id, ctx.channel.id));
    // The brief goes back to scheduled.
    await setBriefStage(tx, ctx.brief.id, ['approved', 'live'], 'scheduled');
    await notifyMany(
      await ownersOf(tx, ctx.brief),
      {
        kind: 'publish_failed',
        title: `${ctx.brief.code} did not post to ${ctx.channel.displayName}`,
        body: `${message} Nothing was retried. Open Publish and press Retry when it is fixed.`,
        link: `/publish/${ctx.brief.id}`,
        entity: 'post',
        entityId: ctx.post.id,
      },
      tx,
    );
    await writeAudit({ actorId: null, action: 'post.fail', entity: 'post', entityId: ctx.post.id, before: ctx.post, after }, tx);
  });
}

/* ---------- Worker: sweep, WhatsApp reminders, token refresh ---------- */

/** Due posts and reminders. Returns how many jobs were queued. */
export async function sweepDuePosts(now = new Date()): Promise<{ publish: number; reminders: number }> {
  const due = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.status, 'scheduled'), lte(posts.scheduledAt, now)))
    .orderBy(asc(posts.scheduledAt))
    .limit(200);
  for (const p of due) await postPublishJob.send({ postId: p.id }, { singletonKey: `post-${p.id}` });

  const reminders = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.status, 'manual_pending'),
        lte(posts.scheduledAt, now),
        sql`not exists (select 1 from ${notifications} n where n.entity = 'post' and n.entity_id = ${posts.id}::text and n.kind = 'publish_reminder')`,
      ),
    )
    .limit(200);
  for (const p of reminders) await whatsappReminderJob.send({ postId: p.id }, { singletonKey: `remind-${p.id}` });
  return { publish: due.length, reminders: reminders.length };
}

/** Sends the by-hand reminder once per post. Returns false when it was not needed. */
export async function sendPostReminder(postId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [locked] = await tx.select().from(posts).where(eq(posts.id, postId)).for('update').limit(1);
    if (!locked || locked.status !== 'manual_pending') return false;
    const [already] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.entity, 'post'), eq(notifications.entityId, postId), eq(notifications.kind, 'publish_reminder')))
      .limit(1);
    if (already) return false;
    const ctx = await requirePostContext(postId, tx);
    const when = ctx.post.scheduledAt ? formatWhen(ctx.post.scheduledAt, ctx.post.audienceTz) : 'now';
    const sent = await notifyMany(
      await ownersOf(tx, ctx.brief),
      {
        kind: 'publish_reminder',
        title: `Post ${ctx.brief.code} to ${ctx.channel.displayName} by hand`,
        body: `It is time (${when}). Open Publish, download the file, post it, then press "Mark as posted".`,
        link: `/publish/${ctx.brief.id}`,
        entity: 'post',
        entityId: postId,
      },
      tx,
    );
    await writeAudit({ actorId: null, action: 'post.remind', entity: 'post', entityId: postId, after: { recipients: sent } }, tx);
    return sent > 0;
  });
}

/** Renews tokens that expire within 7 days; warns the person who connected when we cannot. */
export async function refreshExpiringTokens(now = new Date()): Promise<{ refreshed: number; warned: number }> {
  const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
  const rows = await db
    .select()
    .from(channelAccounts)
    .where(and(sql`${channelAccounts.accessTokenEnc} is not null`, lte(channelAccounts.expiresAt, horizon)));
  let refreshed = 0;
  let warned = 0;
  for (const row of rows) {
    const provider = providerForPlatform(row.platform);
    if (row.refreshTokenEnc && provider?.refresh) {
      try {
        const tokens = await provider.refresh(decryptSecret(row.refreshTokenEnc));
        await db
          .update(channelAccounts)
          .set({
            accessTokenEnc: encryptSecret(tokens.accessToken),
            refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : row.refreshTokenEnc,
            expiresAt: tokens.expiresAt,
            lastError: null,
          })
          .where(eq(channelAccounts.id, row.id));
        await writeAudit({ actorId: null, action: 'channel.token_refresh', entity: 'channel_account', entityId: row.id });
        refreshed += 1;
        continue;
      } catch (err) {
        logger.warn({ err, channelAccountId: row.id }, 'token refresh failed');
      }
    }
    const note = `Token expires ${row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : 'soon'}. Reconnect on Integrations.`;
    if (row.lastError !== note) {
      await db.update(channelAccounts).set({ lastError: note }).where(eq(channelAccounts.id, row.id));
      await notifyMany([row.connectedById], {
        kind: 'system',
        title: `${row.displayName} needs to be reconnected`,
        body: note,
        link: '/integrations',
        entity: 'channel_account',
        entityId: row.id,
      });
      warned += 1;
    }
  }
  return { refreshed, warned };
}
