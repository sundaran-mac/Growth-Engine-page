/**
 * Module contract for the ideas module (Ideas board, Generate with Claude, Plan, occasions).
 * Owned by the IDEAS module agent. Response records reuse `entities.ts`.
 */
import { z } from 'zod';
import { isoDateSchema, isoDateTimeSchema, isoMonthSchema, uuidSchema } from '../common.js';
import { ideaSchema, occasionSchema, planItemSchema, planSchema, briefSchema } from '../entities.js';
import { contentModeSchema, ideaStatusSchema, platformSchema } from '../enums.js';

const trimmed = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/* ---------- Ideas ---------- */

export const IDEA_TITLE_MAX = 160;
export const IDEA_SUMMARY_MAX = 600;
export const PARK_REASON_MAX = 160;
export const GENERATE_MAX_COUNT = 20;
/** A "similar" idea, hook or caption can still be saved with a reason of at least this length. */
export const SIMILAR_REASON_MIN = 10;
export const SIMILAR_REASON_MAX = 300;

/** Why a person keeps something the content memory found similar. Stored in the audit log. */
export const similarReasonSchema = z.string().trim().min(SIMILAR_REASON_MIN, `Write at least ${SIMILAR_REASON_MIN} characters`).max(SIMILAR_REASON_MAX);

export const ideaListQuerySchema = z.object({
  productId: uuidSchema,
  status: ideaStatusSchema.optional(),
  mode: contentModeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type IdeaListQuery = z.infer<typeof ideaListQuerySchema>;

export const ideaCreateSchema = z.object({
  productId: uuidSchema,
  title: trimmed(IDEA_TITLE_MAX),
  summary: optionalText(IDEA_SUMMARY_MAX),
  mode: contentModeSchema,
  channels: z.array(platformSchema).max(5).default([]),
  fitScore: z.number().int().min(0).max(100).nullable().optional(),
  /** Needed only when the title is similar to an earlier idea (409 IDEA_SIMILAR). */
  similarReason: similarReasonSchema.optional(),
});
export type IdeaCreateInput = z.input<typeof ideaCreateSchema>;
export type IdeaCreate = z.infer<typeof ideaCreateSchema>;

export const ideaUpdateSchema = z
  .object({
    title: trimmed(IDEA_TITLE_MAX).optional(),
    summary: optionalText(IDEA_SUMMARY_MAX),
    mode: contentModeSchema.optional(),
    channels: z.array(platformSchema).max(5).optional(),
    fitScore: z.number().int().min(0).max(100).nullable().optional(),
    /** Needed only when the new title is similar to an earlier idea (409 IDEA_SIMILAR). */
    similarReason: similarReasonSchema.optional(),
  })
  .refine((v) => Object.entries(v).some(([k, x]) => k !== 'similarReason' && x !== undefined), {
    message: 'Change at least one field',
  });
export type IdeaUpdateInput = z.input<typeof ideaUpdateSchema>;

/** `POST /ideas/:id/star`. `starred: false` moves a starred idea back to new. */
export const ideaStarSchema = z.object({ starred: z.boolean().default(true) });
export type IdeaStarInput = z.input<typeof ideaStarSchema>;

export const ideaParkSchema = z.object({ reason: trimmed(PARK_REASON_MAX) });
export type IdeaParkInput = z.input<typeof ideaParkSchema>;

export const ideaGenerateSchema = z.object({
  productId: uuidSchema,
  /** Null or missing means any mode. */
  mode: contentModeSchema.nullable().optional(),
  channels: z.array(platformSchema).max(5).default([]),
  count: z.number().int().min(1).max(GENERATE_MAX_COUNT).default(10),
});
export type IdeaGenerateInput = z.input<typeof ideaGenerateSchema>;

export const ideaGenerateResponseSchema = z.object({
  items: z.array(ideaSchema),
  /** Ideas Claude drafted that were dropped for any reason (never-say hit, repeat, wrong mode). */
  dropped: z.number().int().nonnegative(),
  /** Of `dropped`, the drafts that repeated an earlier idea (content memory). */
  droppedAsDuplicate: z.number().int().nonnegative(),
  /** Claude calls made (1 to 3): extra rounds ask only for the missing number. */
  rounds: z.number().int().min(1),
});
export type IdeaGenerateResponse = z.infer<typeof ideaGenerateResponseSchema>;

export const ideaOpenBriefResponseSchema = z.object({ brief: briefSchema });
export type IdeaOpenBriefResponse = z.infer<typeof ideaOpenBriefResponseSchema>;

export const weeklyProposalSchema = z.object({
  runId: uuidSchema,
  weekStart: isoDateSchema,
  ideasCreated: z.number().int().nonnegative(),
  githubPrUrl: z.string().nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
});
export type WeeklyProposal = z.infer<typeof weeklyProposalSchema>;

/** `GET /ideas/board?productId`: what the board needs beside the ideas themselves. */
export const ideaBoardInfoSchema = z.object({
  claude: z.object({
    enabled: z.boolean(),
    usedTokens: z.number().int().nonnegative(),
    capTokens: z.number().int().nonnegative(),
  }),
  weeklyProposal: weeklyProposalSchema.nullable(),
});
export type IdeaBoardInfo = z.infer<typeof ideaBoardInfoSchema>;

export const ideasProductQuerySchema = z.object({ productId: uuidSchema });
export type IdeasProductQuery = z.infer<typeof ideasProductQuerySchema>;

/* ---------- Plans ---------- */

export const planQuerySchema = z.object({ productId: uuidSchema, month: isoMonthSchema });
export type PlanQuery = z.infer<typeof planQuerySchema>;

export const planItemViewSchema = planItemSchema.extend({ briefCode: z.string().nullable() });
export type PlanItemView = z.infer<typeof planItemViewSchema>;

export const planViewSchema = planSchema.extend({ items: z.array(planItemViewSchema) });
export type PlanView = z.infer<typeof planViewSchema>;

/** `GET /plans`: null when the month has no plan yet. */
export const planGetResponseSchema = z.object({ plan: planViewSchema.nullable() });
export type PlanGetResponse = z.infer<typeof planGetResponseSchema>;

export const planCreateSchema = z.object({ productId: uuidSchema, month: isoMonthSchema });
export type PlanCreateInput = z.input<typeof planCreateSchema>;

export const PLAN_ITEM_TITLE_MAX = 120;

export const planItemCreateSchema = z
  .object({
    date: isoDateSchema,
    /** Required unless `ideaId` is given (the idea's title is used). */
    title: trimmed(PLAN_ITEM_TITLE_MAX).optional(),
    mode: contentModeSchema.nullable().optional(),
    channel: platformSchema.nullable().optional(),
    ideaId: uuidSchema.nullable().optional(),
    occasionId: uuidSchema.nullable().optional(),
    needsShootSlot: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.title) || Boolean(v.ideaId), {
    message: 'Give a title or pick an idea',
    path: ['title'],
  });
export type PlanItemCreateInput = z.input<typeof planItemCreateSchema>;

export const planItemUpdateSchema = z
  .object({
    date: isoDateSchema.optional(),
    title: trimmed(PLAN_ITEM_TITLE_MAX).optional(),
    mode: contentModeSchema.nullable().optional(),
    channel: platformSchema.nullable().optional(),
    needsShootSlot: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one field',
  });
export type PlanItemUpdateInput = z.input<typeof planItemUpdateSchema>;

export const planFreezeResponseSchema = z.object({
  plan: planViewSchema,
  briefsCreated: z.number().int().nonnegative(),
  /** Items left without a brief because they have no idea (for example occasion posts). */
  itemsWithoutIdea: z.number().int().nonnegative(),
});
export type PlanFreezeResponse = z.infer<typeof planFreezeResponseSchema>;

/**
 * NO_SHOOT_SLOT and EMPTY_WEEK are about this plan's product. PRODUCT_EMPTY_WEEK is the
 * cross-product check: another product with a signed kit has nothing planned in a week.
 */
export const PLAN_WARNING_CODES = ['NO_SHOOT_SLOT', 'EMPTY_WEEK', 'PRODUCT_EMPTY_WEEK'] as const;
export const planWarningSchema = z.object({
  code: z.enum(PLAN_WARNING_CODES),
  message: z.string(),
  itemIds: z.array(uuidSchema),
  /** Week number inside the month calendar (1 = the row that holds the 1st), for EMPTY_WEEK. */
  week: z.number().int().positive().nullable(),
  /** The other product, for PRODUCT_EMPTY_WEEK; null for this plan's own warnings. */
  productId: uuidSchema.nullable(),
});
export type PlanWarning = z.infer<typeof planWarningSchema>;

export const planChecksSchema = z.object({
  planId: uuidSchema,
  total: z.number().int().nonnegative(),
  mix: z.array(z.object({ mode: contentModeSchema, count: z.number().int().nonnegative() })),
  occasions: z.array(occasionSchema),
  warnings: z.array(planWarningSchema),
});
export type PlanChecks = z.infer<typeof planChecksSchema>;

/* ---------- Occasions ---------- */

export const occasionListQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    productId: uuidSchema.optional(),
  })
  .refine((v) => v.from <= v.to, { message: '`from` must be on or before `to`', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 400 * 86_400_000, {
    message: 'Range can be at most 400 days',
    path: ['to'],
  });
export type OccasionListQuery = z.infer<typeof occasionListQuerySchema>;

export const occasionCreateSchema = z
  .object({
    name: trimmed(120),
    date: isoDateSchema,
    endDate: isoDateSchema.nullable().optional(),
    notes: optionalText(500),
    productIds: z.array(uuidSchema).max(50).default([]),
  })
  .refine((v) => !v.endDate || v.endDate >= v.date, {
    message: 'End date must be on or after the date',
    path: ['endDate'],
  });
export type OccasionCreateInput = z.input<typeof occasionCreateSchema>;
