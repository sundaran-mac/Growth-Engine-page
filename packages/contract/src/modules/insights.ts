/**
 * Module contract for the insights module (Home dashboard, Analytics, Monday note, Sales,
 * keyword replies, Meta webhook, notifications).
 * Owned by the INSIGHTS module agent. Re-exported from the package root.
 */
import { z } from 'zod';
import {
  isoDateSchema,
  isoDateTimeSchema,
  MAX_PAGE_SIZE,
  timeZoneSchema,
  uuidSchema,
} from '../common.js';
import {
  briefKindSchema,
  contentModeSchema,
  leadActivityKindSchema,
  leadSourceSchema,
  leadStageSchema,
  platformSchema,
  postStatusSchema,
  productStatusSchema,
} from '../enums.js';
import {
  keywordRuleSchema,
  leadActivitySchema,
  leadSchema,
  notificationSchema,
  weeklyNoteSchema,
} from '../entities.js';

/* ---------- Shared bits ---------- */

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/** `true` / `false` in a query string. */
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/** Free text with the edges trimmed; empty means "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

/** Analytics windows offered by the range filter. */
export const ANALYTICS_RANGES = [7, 28, 90] as const;
export const analyticsRangeSchema = z.coerce
  .number()
  .int()
  .refine((n) => (ANALYTICS_RANGES as readonly number[]).includes(n), 'Use 7, 28 or 90');
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

/** How a post goes out, shown on Home ("Scheduled · auto", "Reminder · post by hand"). */
export const POST_DELIVERIES = ['auto', 'manual', 'needs_approval'] as const;
export const postDeliverySchema = z.enum(POST_DELIVERIES);
export type PostDelivery = z.infer<typeof postDeliverySchema>;

/** Metric totals for one window (sums of daily snapshots). */
export const metricTotalsSchema = z.object({
  reach: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  activations: z.number().int().nonnegative(),
  /** Value per 1,000 reach over the window (0 when reach is 0). */
  valueScore: z.number().nonnegative(),
});
export type MetricTotals = z.infer<typeof metricTotalsSchema>;

/** A number with its value for the window before, and the change in percent (null when no base). */
export const statWithDeltaSchema = z.object({
  value: z.number().nonnegative(),
  previous: z.number().nonnegative(),
  deltaPct: z.number().nullable(),
});
export type StatWithDelta = z.infer<typeof statWithDeltaSchema>;

/* ---------- Dashboard (Home) ---------- */

export const dashboardQuerySchema = z.object({
  productId: uuidSchema.optional(),
  /** Viewer time zone for "today". Defaults to the app time zone. */
  tz: timeZoneSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const NEEDS_YOU_KINDS = ['approval', 'plan_to_freeze', 'keyword_comments'] as const;
export const needsYouKindSchema = z.enum(NEEDS_YOU_KINDS);
export type NeedsYouKind = z.infer<typeof needsYouKindSchema>;

export const needsYouItemSchema = z.object({
  id: z.string(),
  kind: needsYouKindSchema,
  title: z.string(),
  meta: z.string(),
  /** In-app path for the action button. */
  link: z.string(),
  /** When the wait started (approval requested, first comment), for "waiting 6 h". */
  since: isoDateTimeSchema.nullable(),
});
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

export const todayPostSchema = z.object({
  postId: uuidSchema,
  briefId: uuidSchema,
  briefCode: z.string(),
  briefKind: briefKindSchema,
  title: z.string(),
  platform: platformSchema,
  scheduledAt: isoDateTimeSchema,
  audienceTz: z.string(),
  status: postStatusSchema,
  delivery: postDeliverySchema,
});
export type TodayPost = z.infer<typeof todayPostSchema>;

export const nextPostSchema = z.object({
  platform: platformSchema,
  /** `post` = a scheduled post; `slot` = the next free posting slot (nothing booked yet). */
  source: z.enum(['post', 'slot']),
  at: isoDateTimeSchema,
  audienceTz: z.string(),
  postId: uuidSchema.nullable(),
  briefId: uuidSchema.nullable(),
  briefCode: z.string().nullable(),
  title: z.string().nullable(),
});
export type NextPost = z.infer<typeof nextPostSchema>;

export const pipelineCountsSchema = z.object({
  new: z.number().int().nonnegative(),
  qualified: z.number().int().nonnegative(),
  talking: z.number().int().nonnegative(),
  pilot: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
});
export type PipelineCounts = z.infer<typeof pipelineCountsSchema>;

export const dashboardProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  color: z.string().nullable(),
  status: productStatusSchema,
  piecesThisWeek: z.number().int().nonnegative(),
  kitSigned: z.boolean(),
});
export type DashboardProduct = z.infer<typeof dashboardProductSchema>;

export const dashboardResponseSchema = z.object({
  productId: uuidSchema.nullable(),
  /** Today in the viewer zone, `YYYY-MM-DD`. */
  today: isoDateSchema,
  timezone: z.string(),
  stats: z.object({
    reach7d: statWithDeltaSchema,
    savesShares7d: statWithDeltaSchema,
    installs7d: statWithDeltaSchema,
    openLeads: z.object({
      value: z.number().int().nonnegative(),
      newThisWeek: z.number().int().nonnegative(),
    }),
  }),
  needsYou: z.array(needsYouItemSchema),
  goingOutToday: z.array(todayPostSchema),
  nextPosts: z.array(nextPostSchema),
  claudeThisWeek: z.object({
    note: weeklyNoteSchema.nullable(),
    newIdeasThisWeek: z.number().int().nonnegative(),
  }),
  pipeline: pipelineCountsSchema,
  products: z.array(dashboardProductSchema),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

/* ---------- Analytics ---------- */

export const analyticsQuerySchema = z.object({
  productId: uuidSchema.optional(),
  days: analyticsRangeSchema.default(28),
});
export type AnalyticsQuery = z.input<typeof analyticsQuerySchema>;

export const analyticsRangeInfoSchema = z.object({
  days: z.number().int().positive(),
  from: isoDateSchema,
  to: isoDateSchema,
});

export const reachWeekSchema = z.object({
  /** Monday of the week, `YYYY-MM-DD`. */
  weekStart: isoDateSchema,
  /** ISO week number, for labels like "Week 38". */
  isoWeek: z.number().int().min(1).max(53),
  reach: z.number().int().nonnegative(),
});
export type ReachWeek = z.infer<typeof reachWeekSchema>;

export const analyticsSummarySchema = z.object({
  range: analyticsRangeInfoSchema,
  totals: metricTotalsSchema,
  previous: metricTotalsSchema,
  deltas: z.object({
    reach: z.number().nullable(),
    savesShares: z.number().nullable(),
    installs: z.number().nullable(),
    activations: z.number().nullable(),
  }),
  /** Activations as a share of installs, 0 to 100 (null when there are no installs). */
  activationRatePct: z.number().nullable(),
  reachByWeek: z.array(reachWeekSchema),
  /** True when the numbers come from seeded sample posts. */
  isSample: z.boolean(),
  /** True when any snapshot exists in the window. */
  hasData: z.boolean(),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

export const channelInsightSchema = z.object({
  platform: platformSchema,
  posts: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  valueScore: z.number().nonnegative(),
});
export type ChannelInsight = z.infer<typeof channelInsightSchema>;

export const analyticsByChannelSchema = z.object({
  range: analyticsRangeInfoSchema,
  items: z.array(channelInsightSchema),
});
export type AnalyticsByChannel = z.infer<typeof analyticsByChannelSchema>;

export const modeInsightSchema = z.object({
  mode: contentModeSchema,
  /** Distinct briefs with numbers in the window. */
  pieces: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  valuePer1k: z.number().nonnegative(),
  bestChannel: platformSchema.nullable(),
});
export type ModeInsight = z.infer<typeof modeInsightSchema>;

export const analyticsByModeSchema = z.object({
  range: analyticsRangeInfoSchema,
  items: z.array(modeInsightSchema),
});
export type AnalyticsByMode = z.infer<typeof analyticsByModeSchema>;

export const analyticsPostsQuerySchema = analyticsQuerySchema.extend({
  ...pageQuery,
  sort: z.enum(['value', 'reach', 'installs', 'published']).default('value'),
});
export type AnalyticsPostsQuery = z.input<typeof analyticsPostsQuerySchema>;

export const postInsightSchema = metricTotalsSchema.extend({
  postId: uuidSchema,
  briefId: uuidSchema,
  briefCode: z.string(),
  title: z.string(),
  mode: contentModeSchema,
  platform: platformSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  liveUrl: z.string().nullable(),
});
export type PostInsight = z.infer<typeof postInsightSchema>;

export const analyticsPostsResponseSchema = z.object({
  items: z.array(postInsightSchema),
  total: z.number().int().nonnegative(),
});
export type AnalyticsPostsResponse = z.infer<typeof analyticsPostsResponseSchema>;

/* ---------- Monday note ---------- */

export const latestNoteQuerySchema = z.object({ productId: uuidSchema.optional() });
export type LatestNoteQuery = z.infer<typeof latestNoteQuerySchema>;

export const latestNoteResponseSchema = z.object({
  note: weeklyNoteSchema.nullable(),
  /** True when the note is the ecosystem note (no product note yet). */
  isEcosystem: z.boolean(),
});
export type LatestNoteResponse = z.infer<typeof latestNoteResponseSchema>;

export const generateNoteRequestSchema = z.object({
  productId: uuidSchema,
  /** Monday `YYYY-MM-DD`. Defaults to this week's Monday. */
  weekStart: isoDateSchema.optional(),
  /** Rewrite the note when one exists for that week. */
  regenerate: z.boolean().default(false),
});
export type GenerateNoteRequest = z.input<typeof generateNoteRequestSchema>;

/* ---------- Leads ---------- */

/** Stages shown as columns on the Sales board (LOST is hidden by the filter). */
export const LEAD_BOARD_STAGES = ['new', 'qualified', 'talking', 'pilot', 'review', 'won'] as const;

export const listLeadsQuerySchema = z.object({
  productId: uuidSchema.optional(),
  stage: leadStageSchema.optional(),
  includeLost: queryBoolean,
  ...pageQuery,
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(100),
});
export type ListLeadsQuery = z.input<typeof listLeadsQuerySchema>;

/** A lead plus the readable product and source-post bits the board shows. */
export const leadViewSchema = leadSchema.extend({
  productName: z.string(),
  productShortName: z.string(),
  productColor: z.string().nullable(),
  sourcePostBriefCode: z.string().nullable(),
  sourcePostPlatform: platformSchema.nullable(),
});
export type LeadView = z.infer<typeof leadViewSchema>;

export const leadListResponseSchema = z.object({
  items: z.array(leadViewSchema),
  total: z.number().int().nonnegative(),
});
export type LeadListResponse = z.infer<typeof leadListResponseSchema>;

const leadFields = {
  organisation: z.string().trim().min(1, 'Enter the organisation').max(200),
  sourceText: optionalText(300),
  who: optionalText(300),
  firstOffer: optionalText(500),
  ownerId: uuidSchema.nullable().optional(),
  ownerNote: optionalText(200),
  nextStep: optionalText(300),
  nextStepAt: isoDateTimeSchema.nullable().optional(),
};

export const createLeadRequestSchema = z.object({
  productId: uuidSchema,
  source: leadSourceSchema.default('manual'),
  sourcePostId: uuidSchema.nullable().optional(),
  stage: leadStageSchema.default('new'),
  ...leadFields,
});
export type CreateLeadRequest = z.input<typeof createLeadRequestSchema>;

export const updateLeadRequestSchema = z
  .object({ ...leadFields, organisation: leadFields.organisation.optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one field');
export type UpdateLeadRequest = z.input<typeof updateLeadRequestSchema>;

export const moveLeadRequestSchema = z.object({
  stage: leadStageSchema,
  note: optionalText(1000),
});
export type MoveLeadRequest = z.input<typeof moveLeadRequestSchema>;

/** Activities a person logs by hand (stage changes come from "move"). */
export const MANUAL_LEAD_ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting'] as const;

export const createLeadActivityRequestSchema = z.object({
  kind: leadActivityKindSchema.refine(
    (k) => (MANUAL_LEAD_ACTIVITY_KINDS as readonly string[]).includes(k),
    'Stage changes are logged by moving the lead',
  ),
  body: z.string().trim().min(1, 'Write what happened').max(4000),
});
export type CreateLeadActivityRequest = z.input<typeof createLeadActivityRequestSchema>;

export const leadActivityListResponseSchema = z.object({
  items: z.array(leadActivitySchema),
  total: z.number().int().nonnegative(),
});
export type LeadActivityListResponse = z.infer<typeof leadActivityListResponseSchema>;

/* ---------- Keyword rules and events ---------- */

export const keywordTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_-]+$/, 'One word: letters, numbers, - or _'));

export const listKeywordRulesQuerySchema = z.object({ productId: uuidSchema.optional() });

export const keywordRuleViewSchema = keywordRuleSchema.extend({
  queuedCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(),
});
export type KeywordRuleView = z.infer<typeof keywordRuleViewSchema>;

export const keywordRuleListResponseSchema = z.object({
  items: z.array(keywordRuleViewSchema),
  total: z.number().int().nonnegative(),
});
export type KeywordRuleListResponse = z.infer<typeof keywordRuleListResponseSchema>;

export const createKeywordRuleRequestSchema = z.object({
  productId: uuidSchema,
  platform: platformSchema.default('instagram'),
  keyword: keywordTextSchema,
  replyText: z.string().trim().min(1, 'Write the reply').max(900),
  link: z.url().max(2000).nullable().optional(),
  active: z.boolean().default(true),
});
export type CreateKeywordRuleRequest = z.input<typeof createKeywordRuleRequestSchema>;

export const updateKeywordRuleRequestSchema = z
  .object({
    replyText: z.string().trim().min(1).max(900).optional(),
    link: z.url().max(2000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one field');
export type UpdateKeywordRuleRequest = z.input<typeof updateKeywordRuleRequestSchema>;

export const KEYWORD_REPLY_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;
export const keywordReplyStatusSchema = z.enum(KEYWORD_REPLY_STATUSES);
export type KeywordReplyStatus = z.infer<typeof keywordReplyStatusSchema>;

export const keywordEventSchema = z.object({
  id: uuidSchema,
  ruleId: uuidSchema,
  keyword: z.string(),
  platform: platformSchema,
  postId: uuidSchema.nullable(),
  briefCode: z.string().nullable(),
  authorHandle: z.string().nullable(),
  commentText: z.string().nullable(),
  replyStatus: keywordReplyStatusSchema,
  leadId: uuidSchema.nullable(),
  error: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type KeywordEvent = z.infer<typeof keywordEventSchema>;

export const listKeywordEventsQuerySchema = z.object({
  productId: uuidSchema.optional(),
  status: keywordReplyStatusSchema.optional(),
  ...pageQuery,
});
export type ListKeywordEventsQuery = z.input<typeof listKeywordEventsQuerySchema>;

export const keywordEventListResponseSchema = z.object({
  items: z.array(keywordEventSchema),
  total: z.number().int().nonnegative(),
});
export type KeywordEventListResponse = z.infer<typeof keywordEventListResponseSchema>;

/* ---------- Meta webhook (Instagram comments) ---------- */

export const metaWebhookVerifyQuerySchema = z.object({
  'hub.mode': z.literal('subscribe'),
  'hub.verify_token': z.string().min(1).max(500),
  'hub.challenge': z.string().min(1).max(500),
});

const metaCommentValueSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(10_000).optional(),
  from: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
  media: z.object({ id: z.string().min(1) }).optional(),
});

/** Only the parts we use. Unknown fields are ignored. */
export const metaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z
          .array(z.object({ field: z.string(), value: z.unknown() }))
          .optional()
          .default([]),
      }),
    )
    .default([]),
});
export type MetaWebhookPayload = z.infer<typeof metaWebhookPayloadSchema>;
export const metaCommentChangeSchema = metaCommentValueSchema;
export type MetaCommentValue = z.infer<typeof metaCommentValueSchema>;

export const metaWebhookResultSchema = z.object({
  received: z.number().int().nonnegative(),
  matched: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  leadsCreated: z.number().int().nonnegative(),
});
export type MetaWebhookResult = z.infer<typeof metaWebhookResultSchema>;

/* ---------- Notifications ---------- */

export const listNotificationsQuerySchema = z.object({
  unread: queryBoolean,
  ...pageQuery,
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});
export type ListNotificationsQuery = z.input<typeof listNotificationsQuerySchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  total: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const readAllNotificationsResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
});
export type ReadAllNotificationsResponse = z.infer<typeof readAllNotificationsResponseSchema>;
