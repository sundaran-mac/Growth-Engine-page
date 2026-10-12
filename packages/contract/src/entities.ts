/**
 * Response DTOs for every record in the data model (BUILD-PLAN section 5).
 * Field names are camelCase. Dates are ISO strings. Secrets (tokens, hashes) never appear here.
 * Module agents build their request schemas in `modules/<module>.ts` and reuse these for responses.
 */
import { z } from 'zod';
import {
  isoDateSchema,
  isoDateTimeSchema,
  isoMonthSchema,
  specRefSchema,
  uuidSchema,
} from './common.js';
import {
  approvalDecisionSchema,
  approvalGateSchema,
  assetKindSchema,
  assetStatusSchema,
  briefKindSchema,
  briefStageSchema,
  channelActionSchema,
  channelStatusSchema,
  contentModeSchema,
  documentKindSchema,
  documentStatusSchema,
  ideaSourceSchema,
  ideaStatusSchema,
  integrationStatusSchema,
  languageSchema,
  leadActivityKindSchema,
  leadSourceSchema,
  leadStageSchema,
  notificationKindSchema,
  planStatusSchema,
  platformSchema,
  postStatusSchema,
  productRoleSchema,
  productStatusSchema,
  ratioSchema,
  renderJobKindSchema,
  renderJobStatusSchema,
  roleSchema,
  weekdaySchema,
  weeklyRunStatusSchema,
  weeklyRunTriggerSchema,
} from './enums.js';

const timestamps = {
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

/** Small user reference used inside other records. */
export const userRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  initials: z.string(),
});
export type UserRef = z.infer<typeof userRefSchema>;

/* ---------- Person (users + product members) ---------- */

export const userSchema = z.object({
  id: uuidSchema,
  email: z.email(),
  name: z.string(),
  initials: z.string(),
  title: z.string().nullable(),
  role: roleSchema,
  isBrandApprover: z.boolean(),
  isActive: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type User = z.infer<typeof userSchema>;

export const productMemberSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  user: userRefSchema,
  productRole: productRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type ProductMember = z.infer<typeof productMemberSchema>;

/* ---------- Product and product kit ---------- */

export const productSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  shortName: z.string(),
  status: productStatusSchema,
  /** Short line next to the status, for example `v2` or `pulse.humini.app`. */
  statusNote: z.string().nullable(),
  /** Hex colour for the product chip. */
  color: z.string().nullable(),
  repoUrl: z.string().nullable(),
  siteUrl: z.string().nullable(),
  owner: userRefSchema.nullable(),
  backup: userRefSchema.nullable(),
  ...timestamps,
});
export type Product = z.infer<typeof productSchema>;

export const kitBehaviourSchema = z.object({
  text: z.string().min(1),
  specRef: specRefSchema.nullable(),
});
export type KitBehaviour = z.infer<typeof kitBehaviourSchema>;

export const kitNotBuiltSchema = z.object({
  text: z.string().min(1),
  specRef: specRefSchema.nullable(),
});
export type KitNotBuilt = z.infer<typeof kitNotBuiltSchema>;

export const productKitSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  version: z.number().int().positive(),
  promise: z.string().nullable(),
  behaviours: z.array(kitBehaviourSchema),
  neverSay: z.array(z.string()),
  notBuilt: z.array(kitNotBuiltSchema),
  audiences: z.array(z.string()),
  activationEvent: z.string().nullable(),
  truthSources: z.array(z.string()),
  /** Kit completeness out of 10 ("Kit 10/10"). */
  score: z.number().int().min(0).max(10),
  signedBy: userRefSchema.nullable(),
  signedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type ProductKit = z.infer<typeof productKitSchema>;

/* ---------- Occasion ---------- */

export const occasionSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  date: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  notes: z.string().nullable(),
  productIds: z.array(uuidSchema),
  ...timestamps,
});
export type Occasion = z.infer<typeof occasionSchema>;

/* ---------- Idea ---------- */

export const ideaSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  title: z.string(),
  summary: z.string().nullable(),
  mode: contentModeSchema,
  channels: z.array(platformSchema),
  fitScore: z.number().int().min(0).max(100).nullable(),
  status: ideaStatusSchema,
  source: ideaSourceSchema,
  note: z.string().nullable(),
  /** Angle tag, for example "parents abroad / call at their time / role swap". */
  angle: z.string().nullable(),
  briefId: uuidSchema.nullable(),
  briefCode: z.string().nullable(),
  createdBy: userRefSchema.nullable(),
  ...timestamps,
});
export type Idea = z.infer<typeof ideaSchema>;

/* ---------- Plan ---------- */

export const planItemSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  date: isoDateSchema,
  title: z.string(),
  mode: contentModeSchema.nullable(),
  channel: platformSchema.nullable(),
  ideaId: uuidSchema.nullable(),
  briefId: uuidSchema.nullable(),
  occasionId: uuidSchema.nullable(),
  needsShootSlot: z.boolean(),
  position: z.number().int(),
  ...timestamps,
});
export type PlanItem = z.infer<typeof planItemSchema>;

export const planSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  month: isoMonthSchema,
  status: planStatusSchema,
  frozenAt: isoDateTimeSchema.nullable(),
  frozenBy: userRefSchema.nullable(),
  items: z.array(planItemSchema),
  ...timestamps,
});
export type Plan = z.infer<typeof planSchema>;

/* ---------- Brief ---------- */

export const claimFlagSchema = z.object({
  rule: z.enum(['never_say', 'spec_cited', 'not_built', 'brand_line', 'other']),
  status: z.enum(['pass', 'warn', 'fail']),
  message: z.string(),
  suggestion: z.string().nullable(),
});
export type ClaimFlag = z.infer<typeof claimFlagSchema>;

export const briefClaimSchema = z.object({
  text: z.string(),
  /** Where the claim comes from, for example `spec 006` or `kit · ask`. */
  source: z.string(),
  check: z.enum(['matches', 'mismatch', 'unchecked']),
});
export type BriefClaim = z.infer<typeof briefClaimSchema>;

export const claudeSuggestionsSchema = z.object({
  captions: z.array(z.object({ language: languageSchema, text: z.string() })).default([]),
  altHooks: z.array(z.string()).default([]),
  bRoll: z.array(z.string()).default([]),
  generatedAt: isoDateTimeSchema.nullable().default(null),
});
export type ClaudeSuggestions = z.infer<typeof claudeSuggestionsSchema>;

export const briefSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  kind: briefKindSchema,
  productId: uuidSchema,
  ideaId: uuidSchema.nullable(),
  title: z.string(),
  mode: contentModeSchema,
  stage: briefStageSchema,
  hook: z.string().nullable(),
  beats: z.array(z.string()),
  ask: z.string().nullable(),
  ratios: z.array(ratioSchema),
  captionLanguages: z.array(languageSchema),
  channels: z.array(platformSchema),
  owner: userRefSchema.nullable(),
  claimsApprover: userRefSchema.nullable(),
  brandApprover: userRefSchema.nullable(),
  version: z.number().int().positive(),
  claimFlags: z.array(claimFlagSchema),
  claims: z.array(briefClaimSchema),
  claudeSuggestions: claudeSuggestionsSchema,
  frozenAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type Brief = z.infer<typeof briefSchema>;

/* ---------- Asset and render job ---------- */

export const assetSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  kind: assetKindSchema,
  ratio: ratioSchema.nullable(),
  storageKey: z.string(),
  fileName: z.string().nullable(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  status: assetStatusSchema,
  licence: z.string().nullable(),
  consentOnFile: z.boolean(),
  aiGenerated: z.boolean(),
  briefVersion: z.number().int().positive(),
  createdBy: userRefSchema.nullable(),
  ...timestamps,
});
export type Asset = z.infer<typeof assetSchema>;

export const renderJobSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  assetId: uuidSchema.nullable(),
  kind: renderJobKindSchema,
  label: z.string(),
  tool: z.string().nullable(),
  status: renderJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  error: z.string().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type RenderJob = z.infer<typeof renderJobSchema>;

/* ---------- Review ---------- */

export const checklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  done: z.boolean(),
  /** True when the system fills it (loudness, safe zone, link, AI label). */
  auto: z.boolean(),
  detail: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const reviewChecklistSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  version: z.number().int().positive(),
  items: z.array(checklistItemSchema),
  completedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type ReviewChecklist = z.infer<typeof reviewChecklistSchema>;

export const reviewCommentSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  version: z.number().int().positive(),
  author: userRefSchema.nullable(),
  /** Label shown instead of a name, for example `Testing` or `Live owner`. */
  authorLabel: z.string().nullable(),
  timecodeMs: z.number().int().nonnegative().nullable(),
  /** Root comment this one replies to (threads are one level deep); null on a root comment. */
  parentId: uuidSchema.nullable(),
  body: z.string(),
  resolved: z.boolean(),
  resolvedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

/* ---------- Approval ---------- */

export const approvalSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  version: z.number().int().positive(),
  gate: approvalGateSchema,
  approver: userRefSchema.nullable(),
  backup: userRefSchema.nullable(),
  decidedBy: userRefSchema.nullable(),
  decision: approvalDecisionSchema,
  note: z.string().nullable(),
  requestedAt: isoDateTimeSchema,
  dueAt: isoDateTimeSchema,
  escalatedAt: isoDateTimeSchema.nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type Approval = z.infer<typeof approvalSchema>;

/* ---------- Channel account ---------- */

export const channelAccountSchema = z.object({
  id: uuidSchema,
  platform: platformSchema,
  displayName: z.string(),
  /** Short line under the name, for example `Publish, insights, comments`. */
  description: z.string().nullable(),
  handle: z.string().nullable(),
  productId: uuidSchema.nullable(),
  status: channelStatusSchema,
  allowedActions: z.array(channelActionSchema),
  expiresAt: isoDateTimeSchema.nullable(),
  lastError: z.string().nullable(),
  connectedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type ChannelAccount = z.infer<typeof channelAccountSchema>;

/** Non-channel integrations on the Integrations screen (Claude, GitHub, Drive...). */
export const integrationSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: integrationStatusSchema,
  ...timestamps,
});
export type Integration = z.infer<typeof integrationSchema>;

/* ---------- Post and metric snapshot ---------- */

export const postSchema = z.object({
  id: uuidSchema,
  briefId: uuidSchema,
  briefVersion: z.number().int().positive(),
  channelAccountId: uuidSchema,
  platform: platformSchema,
  assetId: uuidSchema.nullable(),
  /** Format line, for example `9:16 · 58 s`. */
  format: z.string().nullable(),
  caption: z.string().nullable(),
  languages: z.array(languageSchema),
  scheduledAt: isoDateTimeSchema.nullable(),
  audienceTz: z.string(),
  status: postStatusSchema,
  externalId: z.string().nullable(),
  liveUrl: z.string().nullable(),
  trackedUrl: z.string().nullable(),
  error: z.string().nullable(),
  publishedAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type Post = z.infer<typeof postSchema>;

export const metricSnapshotSchema = z.object({
  id: uuidSchema,
  postId: uuidSchema,
  date: isoDateSchema,
  reach: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  activations: z.number().int().nonnegative(),
  valueScore: z.number().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type MetricSnapshot = z.infer<typeof metricSnapshotSchema>;

/* ---------- Lead ---------- */

export const leadSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  organisation: z.string(),
  source: leadSourceSchema,
  sourcePostId: uuidSchema.nullable(),
  /** Readable source line, for example `Keyword reply · R11`. */
  sourceText: z.string().nullable(),
  who: z.string().nullable(),
  firstOffer: z.string().nullable(),
  owner: userRefSchema.nullable(),
  ownerNote: z.string().nullable(),
  stage: leadStageSchema,
  nextStep: z.string().nullable(),
  nextStepAt: isoDateTimeSchema.nullable(),
  ...timestamps,
});
export type Lead = z.infer<typeof leadSchema>;

export const leadActivitySchema = z.object({
  id: uuidSchema,
  leadId: uuidSchema,
  actor: userRefSchema.nullable(),
  kind: leadActivityKindSchema,
  body: z.string().nullable(),
  fromStage: leadStageSchema.nullable(),
  toStage: leadStageSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type LeadActivity = z.infer<typeof leadActivitySchema>;

/* ---------- System records exposed to the web ---------- */

export const notificationSchema = z.object({
  id: uuidSchema,
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;

export const keywordRuleSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  platform: platformSchema,
  keyword: z.string(),
  replyText: z.string(),
  link: z.string().nullable(),
  active: z.boolean(),
  ...timestamps,
});
export type KeywordRule = z.infer<typeof keywordRuleSchema>;

export const weeklyNoteSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema.nullable(),
  weekStart: isoDateSchema,
  body: z.string(),
  doMore: z.string().nullable(),
  stopDoing: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type WeeklyNote = z.infer<typeof weeklyNoteSchema>;

export const claudeUsageSchema = z.object({
  productId: uuidSchema.nullable(),
  month: isoMonthSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  capTokens: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),
});
export type ClaudeUsage = z.infer<typeof claudeUsageSchema>;

/* ---------- Product settings, posting slots, product channels ---------- */

/** `HH:mm` 24-hour local time. */
export const localTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const productSettingsSchema = z.object({
  productId: uuidSchema,
  timezone: z.string(),
  launchDate: isoDateSchema.nullable(),
  weeklyRunEnabled: z.boolean(),
  weeklyRunDay: weekdaySchema,
  weeklyRunTime: localTimeSchema,
  weeklyIdeasCount: z.number().int().min(1).max(30),
  weeklyModes: z.array(contentModeSchema),
  githubRepo: z.string().nullable(),
  githubBaseBranch: z.string(),
  weeklyPrEnabled: z.boolean(),
  approvalSlaHours: z.number().int().positive(),
  utmCampaignPrefix: z.string().nullable(),
  trackingBaseUrl: z.string().nullable(),
  claudeMonthlyTokenCap: z.number().int().nonnegative().nullable(),
  autoSchedule: z.boolean(),
  ...timestamps,
});
export type ProductSettings = z.infer<typeof productSettingsSchema>;

export const postingSlotSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  platform: platformSchema,
  weekday: weekdaySchema,
  localTime: localTimeSchema,
  audienceTimezone: z.string(),
  label: z.string().nullable(),
  active: z.boolean(),
  sort: z.number().int(),
  ...timestamps,
});
export type PostingSlot = z.infer<typeof postingSlotSchema>;

export const productChannelSchema = z.object({
  productId: uuidSchema,
  channelAccountId: uuidSchema,
  enabled: z.boolean(),
  defaultLanguages: z.array(languageSchema),
  defaultRatio: ratioSchema.nullable(),
  ...timestamps,
});
export type ProductChannel = z.infer<typeof productChannelSchema>;

/* ---------- Product documents and weekly runs ---------- */

export const productDocumentSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  title: z.string(),
  kind: documentKindSchema,
  storageKey: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  status: documentStatusSchema,
  summary: z.string().nullable(),
  tokenEstimate: z.number().int().nonnegative().nullable(),
  pinned: z.boolean(),
  error: z.string().nullable(),
  uploadedBy: userRefSchema.nullable(),
  ...timestamps,
});
export type ProductDocument = z.infer<typeof productDocumentSchema>;

export const weeklyRunSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  weekStart: isoDateSchema,
  status: weeklyRunStatusSchema,
  ideasCreated: z.number().int().nonnegative(),
  noteId: uuidSchema.nullable(),
  githubPrUrl: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  triggeredBy: weeklyRunTriggerSchema,
  triggeredByUser: userRefSchema.nullable(),
  ...timestamps,
});
export type WeeklyRun = z.infer<typeof weeklyRunSchema>;
