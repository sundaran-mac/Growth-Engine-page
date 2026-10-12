/**
 * Module contract for the gates module (Review checklist, review comments, the two approval
 * gates). Owned by the GATES module agent. Response records reuse `entities.ts`.
 * Names are unique across modules because the package root re-exports every module.
 */
import { z } from 'zod';
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from '../common.js';
import {
  approvalSchema,
  briefClaimSchema,
  checklistItemSchema,
  claimFlagSchema,
  reviewCommentSchema,
  userRefSchema,
} from '../entities.js';
import {
  approvalDecisionSchema,
  approvalGateSchema,
  assetKindSchema,
  assetStatusSchema,
  briefKindSchema,
  briefStageSchema,
  contentModeSchema,
  languageSchema,
  ratioSchema,
} from '../enums.js';

/* ---------- Shared bits ---------- */

/** Query string boolean: `true`, `false`, `1`, `0` (z.coerce.boolean would read "false" as true). */
export const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const trimmedText = (max: number) => z.string().trim().min(1, 'Required').max(max);

/** The eight review checklist items (Figma 241:1193), in display order. */
export const CHECKLIST_KEYS = [
  'claim_check',
  'captions_safe_zone',
  'real_screens',
  'consent',
  'music_licence',
  'tracked_link',
  'ai_label',
  'loudness',
] as const;
export const checklistKeySchema = z.enum(CHECKLIST_KEYS);
export type ChecklistKey = z.infer<typeof checklistKeySchema>;

/** Loudness target for social video (integrated LUFS) and the allowed distance from it (LU). */
export const LOUDNESS_TARGET_LUFS = -14;
export const LOUDNESS_TOLERANCE_LU = 1;

/** Brief stages that show on the Review list. */
export const REVIEW_STAGES = ['made', 'reviewed'] as const;
export const reviewStageSchema = z.enum(REVIEW_STAGES);

export const REVIEW_COMMENT_MAX = 4000;
export const DECISION_NOTE_MAX = 2000;
/** Longest timecode we accept on a comment (6 hours). */
export const TIMECODE_MAX_MS = 6 * 60 * 60 * 1000;

/** Short brief shape used by the Review and Approvals screens. */
export const gateBriefSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  title: z.string(),
  kind: briefKindSchema,
  mode: contentModeSchema,
  stage: briefStageSchema,
  version: z.number().int().positive(),
  hook: z.string().nullable(),
  captionLanguages: z.array(languageSchema),
  productId: uuidSchema,
  productName: z.string(),
  productShortName: z.string(),
  productColor: z.string().nullable(),
  owner: userRefSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type GateBrief = z.infer<typeof gateBriefSchema>;

/* ---------- Review ---------- */

/** `GET /review/queue` */
export const reviewQueueQuerySchema = paginationQuerySchema.extend({
  productId: uuidSchema.optional(),
  stage: reviewStageSchema.optional(),
});
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

export const reviewQueueItemSchema = z.object({
  brief: gateBriefSchema,
  checklistDone: z.number().int().nonnegative(),
  checklistTotal: z.number().int().nonnegative(),
  openComments: z.number().int().nonnegative(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

export const reviewChecklistViewSchema = z.object({
  version: z.number().int().positive(),
  items: z.array(checklistItemSchema),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  complete: z.boolean(),
  completedAt: isoDateTimeSchema.nullable(),
});
export type ReviewChecklistView = z.infer<typeof reviewChecklistViewSchema>;

/** The master asset shown in the preview (the URL comes from MAKE's `GET /assets/:id/url`). */
export const reviewMasterAssetSchema = z.object({
  id: uuidSchema,
  kind: assetKindSchema,
  ratio: ratioSchema.nullable(),
  mimeType: z.string(),
  fileName: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  status: assetStatusSchema,
});
export type ReviewMasterAsset = z.infer<typeof reviewMasterAssetSchema>;

/** `GET /briefs/:id/review` */
export const reviewDetailSchema = z.object({
  brief: gateBriefSchema,
  checklist: reviewChecklistViewSchema,
  master: reviewMasterAssetSchema.nullable(),
  /** Approvals for the current brief version (empty until sent for approval). */
  approvals: z.array(approvalSchema),
  /** The signed-in user may tick the checklist and comment. */
  canReview: z.boolean(),
  /** The signed-in user may send for approval or send back to the brief. */
  canSend: z.boolean(),
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;

/** `PATCH /briefs/:id/review/checklist`: manual ticks only. */
export const updateChecklistRequestSchema = z.object({
  version: z.number().int().positive(),
  items: z
    .array(z.object({ key: checklistKeySchema, done: z.boolean() }))
    .min(1)
    .max(CHECKLIST_KEYS.length),
});
export type UpdateChecklistRequest = z.infer<typeof updateChecklistRequestSchema>;

/**
 * `GET /briefs/:id/comments`. Items are flat, in thread order: each root comment, then its replies
 * (oldest first). A reply carries `parentId`; the web nests by it.
 */
export const reviewCommentsQuerySchema = z.object({
  /** Brief version. Defaults to the current version. */
  version: z.coerce.number().int().positive().optional(),
  includeResolved: queryBooleanSchema.default(true),
});
export type ReviewCommentsQuery = z.infer<typeof reviewCommentsQuerySchema>;

/**
 * `POST /briefs/:id/comments`. With `parentId` the comment is a reply: the parent must be on the
 * same brief and current version (else 422 COMMENT_PARENT_INVALID). A reply to a reply attaches
 * to the root, and a reply takes the root's timecode.
 */
export const createReviewCommentRequestSchema = z.object({
  body: trimmedText(REVIEW_COMMENT_MAX),
  timecodeMs: z.number().int().min(0).max(TIMECODE_MAX_MS).nullable().default(null),
  parentId: uuidSchema.nullable().default(null),
});
export type CreateReviewCommentRequest = z.input<typeof createReviewCommentRequestSchema>;

/**
 * `PATCH /comments/:id`: resolve or reopen; the author may also edit the text. Resolve and reopen
 * act on a whole thread, so they are only allowed on a root comment (422 COMMENT_IS_REPLY).
 */
export const updateReviewCommentRequestSchema = z
  .object({
    resolved: z.boolean().optional(),
    body: trimmedText(REVIEW_COMMENT_MAX).optional(),
  })
  .refine((v) => v.resolved !== undefined || v.body !== undefined, {
    message: 'Change at least one field',
  });
export type UpdateReviewCommentRequest = z.infer<typeof updateReviewCommentRequestSchema>;

export const reviewCommentListSchema = z.object({
  items: z.array(reviewCommentSchema),
  total: z.number().int().nonnegative(),
});

/** `POST /briefs/:id/send-for-approval`. `version` guards against a stale screen. */
export const sendForApprovalRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type SendForApprovalRequest = z.infer<typeof sendForApprovalRequestSchema>;

export const sendForApprovalResponseSchema = z.object({
  brief: gateBriefSchema,
  approvals: z.array(approvalSchema),
});
export type SendForApprovalResponse = z.infer<typeof sendForApprovalResponseSchema>;

/** `POST /briefs/:id/send-back`: back to the brief with a note; the version goes up. */
export const sendBackRequestSchema = z.object({
  version: z.number().int().positive(),
  note: trimmedText(DECISION_NOTE_MAX),
});
export type SendBackRequest = z.infer<typeof sendBackRequestSchema>;

export const sendBackResponseSchema = z.object({ brief: gateBriefSchema });
export type SendBackResponse = z.infer<typeof sendBackResponseSchema>;

/* ---------- Approvals ---------- */

/**
 * `GET /approvals`. `mine=true` (default): approvals where I am the approver, or the backup
 * after escalation. `mine=false`: admins and editors see all, others see their products.
 * Stale approvals (for an older brief version) are left out unless `includeStale=true`.
 */
export const approvalsQuerySchema = paginationQuerySchema.extend({
  decision: approvalDecisionSchema.optional(),
  mine: queryBooleanSchema.default(true),
  productId: uuidSchema.optional(),
  briefId: uuidSchema.optional(),
  gate: approvalGateSchema.optional(),
  includeStale: queryBooleanSchema.default(false),
});
export type ApprovalsQuery = z.infer<typeof approvalsQuerySchema>;

export const approvalListItemSchema = approvalSchema.extend({
  brief: gateBriefSchema,
  /** True when the brief has moved to a newer version: this decision no longer counts. */
  stale: z.boolean(),
  /** True when the signed-in user may decide this gate now. */
  canDecide: z.boolean(),
});
export type ApprovalListItem = z.infer<typeof approvalListItemSchema>;

/** `GET /approvals/:id` */
export const approvalDetailSchema = approvalListItemSchema.extend({
  claims: z.array(briefClaimSchema),
  claimFlags: z.array(claimFlagSchema),
  /** Both gates for the brief's current version. */
  gates: z.array(approvalSchema),
  /** Every decision on this brief, newest first (the decision log). */
  history: z.array(approvalSchema),
});
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;

/** `POST /approvals/:id/decide`. A note is required to request changes. */
export const decideApprovalRequestSchema = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    note: z.string().trim().max(DECISION_NOTE_MAX).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'changes_requested' && !v.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Write a note for the maker' });
    }
  });
export type DecideApprovalRequest = z.infer<typeof decideApprovalRequestSchema>;

export const decideApprovalResponseSchema = z.object({
  approval: approvalSchema,
  brief: gateBriefSchema,
  /** Draft posts created when this decision approved the last gate. */
  postsCreated: z.number().int().nonnegative(),
});
export type DecideApprovalResponse = z.infer<typeof decideApprovalResponseSchema>;
