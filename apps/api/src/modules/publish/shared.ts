/**
 * Cross-module functions of the PUBLISH module. Stub created by the lead with the final
 * signatures; the PUBLISH agent implements the bodies. Other modules import from here only.
 */
import { and, asc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Platform, Post, PostStatus, Ratio } from '@growth-desk/contract';
import { getConnector, instagramPrivateReply, isConnectorError } from '../../connectors/index.js';
import { env } from '../../config/env.js';
import { db, type DbOrTx } from '../../db/client.js';
import { briefs, channelAccounts, posts, productChannels } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { decryptSecret } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { nextFreeSlots } from '../settings/shared.js';
import {
  type ChannelAccountRow,
  getBrief,
  getProduct,
  getPublishSettings,
  howOf,
  loadLearnedWindows,
  readyAssets,
  toPost,
} from './repo.js';
import { learnedKey, learnedWindowTimes, type LearnedWindow } from './best-window.js';
import { buildCaption, buildTrackedLink, chooseAsset, formatLine, nextBestWindow } from './rules.js';

interface Target {
  channel: ChannelAccountRow;
  ratio: Ratio | null;
}

/** Channel accounts a brief posts to, per platform (BUILD-PLAN 10 and the PUBLISH brief). */
async function targetsFor(tx: DbOrTx, productId: string, platforms: readonly Platform[]): Promise<Target[]> {
  if (platforms.length === 0) return [];
  const configured = await tx
    .select({ channel: channelAccounts, pc: productChannels })
    .from(productChannels)
    .innerJoin(channelAccounts, eq(productChannels.channelAccountId, channelAccounts.id))
    .where(eq(productChannels.productId, productId));

  const out: Target[] = [];
  if (configured.length > 0) {
    // The product chose its channels: one post per enabled channel of the brief's platforms.
    for (const { channel, pc } of configured) {
      if (pc.enabled && platforms.includes(channel.platform)) out.push({ channel, ratio: pc.defaultRatio ?? null });
    }
  } else {
    // Nothing chosen yet: every connected account of each platform (shared or this product's).
    // Accounts waiting for platform approval get a draft too, so the row shows that state.
    const rows = await tx
      .select()
      .from(channelAccounts)
      .where(
        and(
          inArray(channelAccounts.platform, [...platforms].filter((p) => p !== 'whatsapp')),
          or(isNull(channelAccounts.productId), eq(channelAccounts.productId, productId)),
        ),
      )
      .orderBy(asc(channelAccounts.createdAt));
    for (const channel of rows) {
      const how = howOf(channel);
      if (how === 'auto' || how === 'needs_approval') out.push({ channel, ratio: null });
    }
  }

  // WhatsApp always gets a reminder post when the brief lists it.
  if (platforms.includes('whatsapp') && !out.some((t) => t.channel.platform === 'whatsapp')) {
    const [wa] = await tx
      .select()
      .from(channelAccounts)
      .where(
        and(
          eq(channelAccounts.platform, 'whatsapp'),
          ne(channelAccounts.status, 'disconnected'),
          or(isNull(channelAccounts.productId), eq(channelAccounts.productId, productId)),
        ),
      )
      .orderBy(asc(channelAccounts.createdAt))
      .limit(1);
    const channel =
      wa ??
      (
        await tx
          .insert(channelAccounts)
          .values({
            platform: 'whatsapp',
            displayName: 'WhatsApp',
            description: 'Channel by hand',
            status: 'manual',
            allowedActions: [],
          })
          .returning()
      )[0];
    if (channel) out.push({ channel, ratio: null });
  }
  return out;
}

/**
 * Times for the posts of one platform: posting slots first, else the best window (learned for
 * this platform and audience zone from week 5, else the starting rule).
 */
async function timesFor(
  tx: DbOrTx,
  productId: string,
  platform: Platform,
  count: number,
  fallback: { timeZone: string; launchDate: string | null; learned: Map<string, LearnedWindow> },
): Promise<{ at: Date; tz: string }[]> {
  const now = new Date();
  let slots: { at: Date; tz: string }[] = [];
  try {
    slots = (await nextFreeSlots(productId, platform, now, count, tx)).map((s) => ({ at: s.at, tz: s.audienceTimezone }));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'NOT_IMPLEMENTED') logger.warn({ err, productId, platform }, 'nextFreeSlots failed; using the best window rule');
  }
  const taken = slots.map((s) => s.at);
  const learned = fallback.learned.get(learnedKey(platform, fallback.timeZone));
  const times = learned ? learnedWindowTimes(learned) : undefined;
  while (slots.length < count) {
    const at = nextBestWindow({
      from: now,
      timeZone: fallback.timeZone,
      launchDate: fallback.launchDate,
      taken,
      ...(times ? { times } : {}),
    });
    taken.push(at);
    slots.push({ at, tz: fallback.timeZone });
  }
  return slots.slice(0, count);
}

/**
 * Called by GATES when both gates approve the current brief version. Creates one draft post per
 * enabled product channel and brief channel, and auto-schedules them when the product setting
 * `auto_schedule` is on. Idempotent per brief version.
 */
export async function createDraftPostsForBrief(briefId: string, actorId: string, tx?: DbOrTx): Promise<Post[]> {
  if (!tx) return db.transaction((t) => createDraftPostsForBrief(briefId, actorId, t));

  const brief = await getBrief(briefId, tx);
  if (!brief) throw notFound('Brief');

  const existing = await tx
    .select({ post: posts, channel: channelAccounts })
    .from(posts)
    .innerJoin(channelAccounts, eq(posts.channelAccountId, channelAccounts.id))
    .where(and(eq(posts.briefId, briefId), eq(posts.briefVersion, brief.version)));
  if (existing.length > 0) return existing.map((r) => toPost(r.post, r.channel.platform));

  // Posts made for an older version never went out and are replaced now.
  const stale = await tx
    .delete(posts)
    .where(and(eq(posts.briefId, briefId), ne(posts.briefVersion, brief.version), ne(posts.status, 'published'), ne(posts.status, 'publishing')))
    .returning({ id: posts.id });

  // One client in a transaction: run the reads one after another.
  const settings = await getPublishSettings(brief.productId, tx);
  const product = await getProduct(brief.productId, tx);
  const assetRows = await readyAssets(briefId, tx);
  const targets = await targetsFor(tx, brief.productId, brief.channels);

  // Times per platform, only when needed: auto schedule on, or a WhatsApp reminder.
  const times = new Map<Platform, { at: Date; tz: string }[]>();
  const learned = targets.length > 0 ? await loadLearnedWindows(brief.productId, tx) : new Map<string, LearnedWindow>();
  for (const platform of new Set(targets.map((t) => t.channel.platform))) {
    if (!settings.autoSchedule && platform !== 'whatsapp') continue;
    const n = targets.filter((t) => t.channel.platform === platform).length;
    times.set(
      platform,
      await timesFor(tx, brief.productId, platform, n, {
        timeZone: settings.timezone,
        launchDate: settings.launchDate,
        learned,
      }),
    );
  }

  const created: Post[] = [];
  for (const { channel, ratio } of targets) {
    const connector = getConnector(channel.platform);
    const ratios = ratio ? [ratio, ...connector.capabilities.ratios.filter((r) => r !== ratio)] : connector.capabilities.ratios;
    const asset = chooseAsset(
      assetRows.map((a) => ({ ...a, ratio: (a.ratio as Ratio | null) ?? null })),
      ratios,
    );
    const slot = times.get(channel.platform)?.shift() ?? null;
    const audienceTz = slot?.tz ?? settings.timezone;
    const link = buildTrackedLink({
      baseUrl: settings.trackingBaseUrl ?? env.trackingLinkBase,
      campaignPrefix: settings.utmCampaignPrefix ?? product?.slug ?? 'humini',
      platform: channel.platform,
      kind: brief.kind,
      mode: brief.mode,
      briefCode: brief.code,
      when: slot?.at ?? new Date(),
      timeZone: audienceTz,
    });
    const how = howOf(channel);
    let status: PostStatus = 'draft';
    if (how === 'reminder' && slot) status = 'manual_pending';
    else if (how === 'auto' && slot && settings.autoSchedule) status = 'scheduled';

    const [row] = await tx
      .insert(posts)
      .values({
        briefId,
        briefVersion: brief.version,
        channelAccountId: channel.id,
        assetId: asset?.id ?? null,
        format: asset ? formatLine(asset.ratio, asset.durationMs) : null,
        caption: buildCaption({
          hook: brief.hook,
          ask: brief.ask,
          trackedUrl: link.url,
          clickableLinks: connector.capabilities.clickableLinks,
          maxLength: connector.capabilities.maxCaptionLength,
        }),
        languages: brief.captionLanguages.length > 0 ? brief.captionLanguages : ['en'],
        scheduledAt: slot?.at ?? null,
        audienceTz,
        status,
        trackedUrl: link.url,
      })
      .returning();
    if (row) created.push(toPost(row, channel.platform));
  }

  if (created.some((p) => p.status === 'scheduled' || p.status === 'manual_pending')) {
    await tx.update(briefs).set({ stage: 'scheduled' }).where(and(eq(briefs.id, briefId), eq(briefs.stage, 'approved')));
  }
  await writeAudit(
    {
      actorId,
      action: 'post.create_drafts',
      entity: 'brief',
      entityId: briefId,
      after: { version: brief.version, created: created.map((p) => ({ id: p.id, platform: p.platform, status: p.status })), replaced: stale.length },
    },
    tx,
  );
  return created;
}

export type PrivateReplyResult = { status: 'sent'; externalId: string } | { status: 'queued'; reason: 'NOT_CONNECTED' | 'NOT_ALLOWED' | 'ERROR'; detail?: string };

/** Called by INSIGHTS for keyword comments. Never throws for platform problems: returns `queued`. */
export async function sendInstagramPrivateReply(input: { channelAccountId: string; commentId: string; message: string }): Promise<PrivateReplyResult> {
  const [channel] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, input.channelAccountId)).limit(1);
  if (!channel || channel.platform !== 'instagram') return { status: 'queued', reason: 'NOT_CONNECTED', detail: 'No Instagram account with this id.' };
  const how = howOf(channel);
  if (!channel.accessTokenEnc || !channel.externalAccountId || how === 'not_connected' || how === 'reminder') {
    return { status: 'queued', reason: 'NOT_CONNECTED' };
  }
  if (!channel.allowedActions.includes('messages')) {
    return { status: 'queued', reason: 'NOT_ALLOWED', detail: 'The Instagram account does not allow messages (instagram_manage_messages).' };
  }
  if (!env.meta) return { status: 'queued', reason: 'NOT_CONNECTED', detail: 'Meta is not set up.' };
  try {
    const externalId = await instagramPrivateReply(
      { externalAccountId: channel.externalAccountId, accessToken: decryptSecret(channel.accessTokenEnc), allowedActions: channel.allowedActions },
      input.commentId,
      input.message,
    );
    return { status: 'sent', externalId };
  } catch (err) {
    logger.warn({ err, channelAccountId: channel.id }, 'instagram private reply failed');
    return { status: 'queued', reason: 'ERROR', detail: isConnectorError(err) ? `${err.code}: ${err.message}` : 'Unexpected error' };
  }
}
