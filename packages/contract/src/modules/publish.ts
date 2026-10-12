/**
 * Module contract for the publish module (channel accounts, OAuth connect, posts, tracked links).
 * Owned by the PUBLISH module agent. Re-exported from the package root, so names are unique.
 */
import { z } from 'zod';
import {
  isoDateTimeSchema,
  paginationQuerySchema,
  timeZoneSchema,
  uuidSchema,
} from '../common.js';
import { channelAccountSchema, postSchema } from '../entities.js';
import {
  approvalDecisionSchema,
  assetKindSchema,
  briefKindSchema,
  briefStageSchema,
  channelStatusSchema,
  contentModeSchema,
  languageSchema,
  platformSchema,
  ratioSchema,
} from '../enums.js';

/* ---------- Error codes of this module ---------- */

export const PUBLISH_ERROR_CODES = [
  'GATE_NOT_ALLOWED',
  'NOT_CONNECTED',
  'NEEDS_APPROVAL',
  'MEDIA_NOT_PUBLIC',
  'NO_MEDIA',
  'UNSUPPORTED_FORMAT',
  'POST_NOT_EDITABLE',
  'OAUTH_STATE_INVALID',
  'OAUTH_DENIED',
  'OAUTH_EXCHANGE_FAILED',
  'OAUTH_NO_ACCOUNTS',
  'PLATFORM_AUTH_FAILED',
  'PLATFORM_RATE_LIMITED',
  'PLATFORM_TIMEOUT',
  'PLATFORM_ERROR',
] as const;
export type PublishErrorCode = (typeof PUBLISH_ERROR_CODES)[number];

/* ---------- OAuth connect ---------- */

/** OAuth provider in the URL. `meta` gives Facebook Pages and linked Instagram accounts. */
export const OAUTH_PLATFORMS = ['meta', 'google', 'linkedin'] as const;
export const oauthPlatformSchema = z.enum(OAUTH_PLATFORMS);
export type OAuthPlatform = z.infer<typeof oauthPlatformSchema>;

export const OAUTH_PLATFORM_LABELS: Record<OAuthPlatform, string> = {
  meta: 'Meta (Instagram and Facebook)',
  google: 'Google (YouTube)',
  linkedin: 'LinkedIn',
};

/** Which OAuth provider connects a channel platform (WhatsApp has none: by hand). */
export const PLATFORM_OAUTH: Record<z.infer<typeof platformSchema>, OAuthPlatform | null> = {
  instagram: 'meta',
  facebook: 'meta',
  youtube: 'google',
  linkedin: 'linkedin',
  whatsapp: null,
};

export const oauthPlatformParamsSchema = z.object({ platform: oauthPlatformSchema });

export const oauthStartQuerySchema = z.object({
  /** Connect the discovered accounts to this product only. Omit to share with every product. */
  productId: uuidSchema.optional(),
});
export type OAuthStartQuery = z.infer<typeof oauthStartQuerySchema>;

export const oauthStartResponseSchema = z.object({ url: z.url() });
export type OAuthStartResponse = z.infer<typeof oauthStartResponseSchema>;

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(4096).optional(),
  error: z.string().max(200).optional(),
  error_description: z.string().max(1000).optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

/* ---------- Channel accounts ---------- */

/**
 * How a post on this channel goes out:
 * `auto` (API), `needs_approval` (platform has not approved our app), `reminder` (by hand,
 * WhatsApp or a manual channel), `not_connected` (no token, disconnected, or expired).
 */
export const PUBLISH_HOWS = ['auto', 'needs_approval', 'reminder', 'not_connected'] as const;
export const publishHowSchema = z.enum(PUBLISH_HOWS);
export type PublishHow = z.infer<typeof publishHowSchema>;

export const PUBLISH_HOW_LABELS: Record<PublishHow, string> = {
  auto: 'Auto via API',
  needs_approval: 'Needs API approval',
  reminder: 'Reminder by hand',
  not_connected: 'Not connected',
};

export const channelAccountViewSchema = channelAccountSchema.extend({
  how: publishHowSchema,
  /** OAuth provider used to (re)connect this account, null for WhatsApp. */
  oauthPlatform: oauthPlatformSchema.nullable(),
});
export type ChannelAccountView = z.infer<typeof channelAccountViewSchema>;

export const channelAccountsQuerySchema = paginationQuerySchema.extend({
  productId: uuidSchema.optional(),
  platform: platformSchema.optional(),
});
export type ChannelAccountsQuery = z.infer<typeof channelAccountsQuerySchema>;

/* ---------- Publish queue (list screen) ---------- */

export const PUBLISH_QUEUE_STAGES = ['approved', 'scheduled', 'live'] as const;
export const publishQueueStageSchema = z.enum(PUBLISH_QUEUE_STAGES);

export const publishQueueQuerySchema = paginationQuerySchema.extend({
  productId: uuidSchema,
  stage: publishQueueStageSchema.optional(),
});
export type PublishQueueQuery = z.infer<typeof publishQueueQuerySchema>;

export const postStatusCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  publishing: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  manual_pending: z.number().int().nonnegative(),
});
export type PostStatusCounts = z.infer<typeof postStatusCountsSchema>;

export const publishQueueItemSchema = z.object({
  briefId: uuidSchema,
  productId: uuidSchema,
  code: z.string(),
  title: z.string(),
  kind: briefKindSchema,
  mode: contentModeSchema,
  stage: briefStageSchema,
  version: z.number().int().positive(),
  channels: z.array(platformSchema),
  counts: postStatusCountsSchema,
  nextScheduledAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type PublishQueueItem = z.infer<typeof publishQueueItemSchema>;

/* ---------- Publish screen for one brief ---------- */

export const publishGateSchema = z.object({
  /** True when the brief is approved and both gates approved its current version. */
  allowed: z.boolean(),
  reason: z.string().nullable(),
  claims: approvalDecisionSchema.nullable(),
  brand: approvalDecisionSchema.nullable(),
});
export type PublishGate = z.infer<typeof publishGateSchema>;

/** Weeks 1 to 4: the starting rule. From week 5 (4 weeks of measured posts): learned. */
export const bestWindowRuleSchema = z.enum(['starting', 'learned']);
export type BestWindowRule = z.infer<typeof bestWindowRuleSchema>;

export const bestWindowSchema = z.object({
  platform: platformSchema,
  audienceTz: z.string(),
  rule: bestWindowRuleSchema,
  /** Local start and end hour (0 to 23) of the learned 2 hour window; null on the starting rule. */
  startHour: z.number().int().min(0).max(23).nullable(),
  endHour: z.number().int().min(0).max(23).nullable(),
  /** Value score per 1k reach of the posts in the window; null on the starting rule. */
  valuePer1kReach: z.number().nullable(),
  /** Measured posts behind the learned window. */
  posts: z.number().int().nonnegative(),
});
export type BestWindow = z.infer<typeof bestWindowSchema>;

export const publishBriefSummarySchema = z.object({
  brief: z.object({
    id: uuidSchema,
    productId: uuidSchema,
    code: z.string(),
    title: z.string(),
    kind: briefKindSchema,
    mode: contentModeSchema,
    stage: briefStageSchema,
    version: z.number().int().positive(),
    channels: z.array(platformSchema),
  }),
  gate: publishGateSchema,
  autoSchedule: z.boolean(),
  /** Product time zone, used as the default audience zone. */
  timezone: z.string(),
  launchDate: z.string().nullable(),
  bestWindow: z.object({
    /** `learned` when at least one channel of the brief has a learned window. */
    rule: bestWindowRuleSchema,
    text: z.string(),
    /** One row per channel of the brief, in the product's audience time zone. */
    windows: z.array(bestWindowSchema),
  }),
});
export type PublishBriefSummary = z.infer<typeof publishBriefSummarySchema>;

export const postChannelRefSchema = z.object({
  id: uuidSchema,
  platform: platformSchema,
  displayName: z.string(),
  handle: z.string().nullable(),
  status: channelStatusSchema,
});

export const postAssetRefSchema = z.object({
  id: uuidSchema,
  kind: assetKindSchema,
  ratio: ratioSchema.nullable(),
  fileName: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

export const postViewSchema = postSchema.extend({
  channel: postChannelRefSchema,
  how: publishHowSchema,
  asset: postAssetRefSchema.nullable(),
});
export type PostView = z.infer<typeof postViewSchema>;

export const updatePostSchema = z
  .object({
    caption: z.string().trim().max(2200).nullable().optional(),
    languages: z.array(languageSchema).max(2).optional(),
    /** Null clears the time (only for draft posts). */
    scheduledAt: isoDateTimeSchema.nullable().optional(),
    audienceTz: timeZoneSchema.optional(),
    assetId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Send at least one field to change',
  });
export type UpdatePostRequest = z.infer<typeof updatePostSchema>;

export const scheduleAllResponseSchema = z.object({
  scheduled: z.number().int().nonnegative(),
  skipped: z.array(z.object({ postId: uuidSchema, reason: z.string() })),
  items: z.array(postViewSchema),
});
export type ScheduleAllResponse = z.infer<typeof scheduleAllResponseSchema>;

export const trackedLinkSchema = z.object({
  url: z.string(),
  /** Same link without the scheme, as shown in the Figma (`live.humini.app/?utm_source=...`). */
  display: z.string(),
  params: z.object({
    utm_source: z.string(),
    utm_medium: z.string(),
    utm_campaign: z.string(),
    utm_content: z.string(),
  }),
});
export type TrackedLink = z.infer<typeof trackedLinkSchema>;

/** Download link for the file of a post (used for WhatsApp by hand). */
export const postMediaUrlSchema = z.object({ url: z.string(), expiresIn: z.number().int() });
export type PostMediaUrl = z.infer<typeof postMediaUrlSchema>;

export const markPostedSchema = z.object({
  liveUrl: z.url().max(2000).optional(),
});
export type MarkPostedRequest = z.infer<typeof markPostedSchema>;

export const publishBriefParamsSchema = z.object({ briefId: uuidSchema });
