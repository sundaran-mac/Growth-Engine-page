/**
 * Every enum in the Growth Desk data model (BUILD-PLAN section 5).
 * Each enum is a readonly tuple (used by Drizzle pgEnum and zod) plus a zod schema and a type.
 */
import { z } from 'zod';

/* ---------- People and access ---------- */

export const ROLES = ['admin', 'editor', 'member', 'viewer'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const PRODUCT_ROLES = ['owner', 'backup', 'maker', 'reviewer'] as const;
export const productRoleSchema = z.enum(PRODUCT_ROLES);
export type ProductRole = z.infer<typeof productRoleSchema>;

/* ---------- Products ---------- */

export const PRODUCT_STATUSES = ['draft', 'in_build', 'live', 'archived'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  in_build: 'In build',
  live: 'Live',
  archived: 'Archived',
};

/* ---------- Ideas ---------- */

export const IDEA_STATUSES = ['new', 'starred', 'briefed', 'parked'] as const;
export const ideaStatusSchema = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof ideaStatusSchema>;

export const IDEA_SOURCES = ['claude', 'human'] as const;
export const ideaSourceSchema = z.enum(IDEA_SOURCES);
export type IdeaSource = z.infer<typeof ideaSourceSchema>;

/* ---------- Content memory (ADR 0009) ---------- */

/** What a content memory row came from. `dropped_draft` is a Claude draft dropped as a repeat. */
export const MEMORY_SOURCE_TYPES = ['idea', 'brief_hook', 'post_caption', 'dropped_draft'] as const;
export const memorySourceTypeSchema = z.enum(MEMORY_SOURCE_TYPES);
export type MemorySourceType = z.infer<typeof memorySourceTypeSchema>;

/** Result of a repeat check: `duplicate` blocks, `similar` needs a reason. */
export const MEMORY_STATUSES = ['unique', 'similar', 'duplicate'] as const;
export const memoryStatusSchema = z.enum(MEMORY_STATUSES);
export type MemoryStatus = z.infer<typeof memoryStatusSchema>;

/** Which check layer found a match. */
export const MEMORY_LAYERS = ['fingerprint', 'text', 'meaning'] as const;
export const memoryLayerSchema = z.enum(MEMORY_LAYERS);
export type MemoryLayer = z.infer<typeof memoryLayerSchema>;

/** Content modes M1..M7 from the Ideas board and Plan mix check. */
export const CONTENT_MODES = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const;
export const contentModeSchema = z.enum(CONTENT_MODES);
export type ContentMode = z.infer<typeof contentModeSchema>;

export const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
  M1: 'Founder',
  M2: 'AI people',
  M3: 'Motion',
  M4: 'Posters',
  M5: 'Fun',
  M6: 'Inside Arus',
  M7: 'Ecosystem',
};

/** Longer names used on Analytics ("M1 Founder films"). */
export const CONTENT_MODE_LONG_LABELS: Record<ContentMode, string> = {
  M1: 'Founder films',
  M2: 'AI people stories',
  M3: 'Motion explainers',
  M4: 'Posters',
  M5: 'Fun',
  M6: 'Inside Arus',
  M7: 'Ecosystem',
};

/* ---------- Plans ---------- */

export const PLAN_STATUSES = ['draft', 'frozen'] as const;
export const planStatusSchema = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof planStatusSchema>;

/* ---------- Briefs ---------- */

export const BRIEF_STAGES = [
  'idea',
  'brief',
  'frozen',
  'made',
  'reviewed',
  'approved',
  'scheduled',
  'live',
] as const;
export const briefStageSchema = z.enum(BRIEF_STAGES);
export type BriefStage = z.infer<typeof briefStageSchema>;

export const BRIEF_STAGE_LABELS: Record<BriefStage, string> = {
  idea: 'Idea',
  brief: 'Brief',
  frozen: 'Frozen',
  made: 'Made',
  reviewed: 'Reviewed',
  approved: 'Approved',
  scheduled: 'Scheduled',
  live: 'Live',
};

/**
 * Allowed brief stage moves (BUILD-PLAN section 7).
 * Forward one step at a time. Backward moves:
 * - request changes at review or approval sends the brief back to `brief` (version bump),
 * - a failed publish sends `live` work back to `scheduled` (fail-safe rule).
 */
export const BRIEF_STAGE_TRANSITIONS: Record<BriefStage, readonly BriefStage[]> = {
  idea: ['brief'],
  brief: ['frozen'],
  frozen: ['made', 'brief'],
  made: ['reviewed', 'brief'],
  reviewed: ['approved', 'brief'],
  approved: ['scheduled', 'brief'],
  scheduled: ['live', 'approved'],
  live: ['scheduled'],
};

export function canMoveBriefStage(from: BriefStage, to: BriefStage): boolean {
  return BRIEF_STAGE_TRANSITIONS[from].includes(to);
}

/** Brief kinds give the human code prefix, for example REEL-031, POSTER-008. */
export const BRIEF_KINDS = ['reel', 'poster', 'short', 'carousel', 'post'] as const;
export const briefKindSchema = z.enum(BRIEF_KINDS);
export type BriefKind = z.infer<typeof briefKindSchema>;

export const BRIEF_KIND_PREFIX: Record<BriefKind, string> = {
  reel: 'REEL',
  poster: 'POSTER',
  short: 'SHORT',
  carousel: 'CAROUSEL',
  post: 'POST',
};

/* ---------- Assets and render jobs ---------- */

export const ASSET_KINDS = ['video', 'poster', 'caption', 'cutdown'] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const ASSET_STATUSES = ['uploading', 'ready', 'failed'] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const;
export const ratioSchema = z.enum(RATIOS);
export type Ratio = z.infer<typeof ratioSchema>;

export const RENDER_JOB_KINDS = ['render', 'voice', 'mix', 'cutdown', 'captions'] as const;
export const renderJobKindSchema = z.enum(RENDER_JOB_KINDS);
export type RenderJobKind = z.infer<typeof renderJobKindSchema>;

export const RENDER_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export const renderJobStatusSchema = z.enum(RENDER_JOB_STATUSES);
export type RenderJobStatus = z.infer<typeof renderJobStatusSchema>;

/* ---------- Review and approvals ---------- */

export const APPROVAL_GATES = ['claims', 'brand'] as const;
export const approvalGateSchema = z.enum(APPROVAL_GATES);
export type ApprovalGate = z.infer<typeof approvalGateSchema>;

export const APPROVAL_DECISIONS = ['pending', 'approved', 'changes_requested'] as const;
export const approvalDecisionSchema = z.enum(APPROVAL_DECISIONS);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/* ---------- Publishing ---------- */

export const PLATFORMS = ['instagram', 'facebook', 'youtube', 'linkedin', 'whatsapp'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

export const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
};

export const POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'manual_pending',
] as const;
export const postStatusSchema = z.enum(POST_STATUSES);
export type PostStatus = z.infer<typeof postStatusSchema>;

export const CHANNEL_STATUSES = [
  'connected',
  'needs_approval',
  'manual',
  'disconnected',
  'error',
] as const;
export const channelStatusSchema = z.enum(CHANNEL_STATUSES);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

export const CHANNEL_ACTIONS = ['publish', 'insights', 'comments', 'messages'] as const;
export const channelActionSchema = z.enum(CHANNEL_ACTIONS);
export type ChannelAction = z.infer<typeof channelActionSchema>;

/* ---------- Sales ---------- */

export const LEAD_STAGES = [
  'new',
  'qualified',
  'talking',
  'pilot',
  'review',
  'won',
  'lost',
] as const;
export const leadStageSchema = z.enum(LEAD_STAGES);
export type LeadStage = z.infer<typeof leadStageSchema>;

export const LEAD_SOURCES = [
  'keyword_reply',
  'tracked_link',
  'dm',
  'website_form',
  'manual',
] as const;
export const leadSourceSchema = z.enum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof leadSourceSchema>;

export const LEAD_ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting', 'stage_change'] as const;
export const leadActivityKindSchema = z.enum(LEAD_ACTIVITY_KINDS);
export type LeadActivityKind = z.infer<typeof leadActivityKindSchema>;

/* ---------- Languages and notifications ---------- */

export const LANGUAGES = ['en', 'ta'] as const;
export const languageSchema = z.enum(LANGUAGES);
export type Language = z.infer<typeof languageSchema>;

export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', ta: 'Tamil' };

export const NOTIFICATION_KINDS = [
  'approval_requested',
  'approval_escalated',
  'approval_decided',
  'ideas_ready',
  'plan_to_freeze',
  'publish_failed',
  'publish_reminder',
  'lead_created',
  'kit_changed',
  'monday_note',
  'system',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/* ---------- Integrations (non-channel) ---------- */

export const INTEGRATION_STATUSES = [
  'connected',
  'hand_off',
  'check_first',
  'not_set_up',
  'disabled',
] as const;
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/* ---------- Product settings, documents and weekly runs ---------- */

/** Weekday numbers follow JavaScript `Date.getDay()`: 0 = Sunday, 1 = Monday ... 6 = Saturday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const weekdaySchema = z.number().int().min(0).max(6);
export type Weekday = z.infer<typeof weekdaySchema>;
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const DOCUMENT_KINDS = ['file', 'url', 'repo_spec', 'note'] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof documentKindSchema>;

export const DOCUMENT_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const WEEKLY_RUN_STATUSES = ['queued', 'running', 'done', 'failed', 'skipped'] as const;
export const weeklyRunStatusSchema = z.enum(WEEKLY_RUN_STATUSES);
export type WeeklyRunStatus = z.infer<typeof weeklyRunStatusSchema>;

export const WEEKLY_RUN_TRIGGERS = ['schedule', 'manual'] as const;
export const weeklyRunTriggerSchema = z.enum(WEEKLY_RUN_TRIGGERS);
export type WeeklyRunTrigger = z.infer<typeof weeklyRunTriggerSchema>;
