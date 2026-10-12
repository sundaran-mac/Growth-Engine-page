/**
 * Module contract for the settings module (per-product settings, knowledge documents,
 * posting slots, product channels, weekly runs and the schedule view).
 * Owned by the SETTINGS module agent. Names are unique across modules (root re-export).
 */
import { z } from 'zod';
import {
  isoDateSchema,
  isoDateTimeSchema,
  listResponseSchema,
  paginationQuerySchema,
  timeZoneSchema,
  uuidSchema,
} from '../common.js';
import {
  channelStatusSchema,
  contentModeSchema,
  languageSchema,
  platformSchema,
  postStatusSchema,
  ratioSchema,
  weekdaySchema,
} from '../enums.js';
import {
  localTimeSchema,
  postingSlotSchema,
  productDocumentSchema,
  productSettingsSchema,
  weeklyRunSchema,
} from '../entities.js';

/* ---------- Params ---------- */

export const settingsProductParamSchema = z.object({ productId: uuidSchema });
export type SettingsProductParam = z.infer<typeof settingsProductParamSchema>;

/* ---------- Product settings ---------- */

/** `owner/name` on GitHub. */
export const githubRepoSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
    'Use owner/name, for example humini-ecosystem/humini-live-app',
  );

/** Git branch name (a safe subset). */
export const gitBranchSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^(?!\/)(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/, 'Use a valid branch name');

/** UTM campaign prefix: lower case words with dashes, for example `live`. */
export const utmPrefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lower case letters, numbers and dashes');

/** PATCH /products/:productId/settings. Every field optional; at least one required. */
export const updateProductSettingsSchema = z
  .object({
    timezone: timeZoneSchema,
    launchDate: isoDateSchema.nullable(),
    weeklyRunEnabled: z.boolean(),
    weeklyRunDay: weekdaySchema,
    weeklyRunTime: localTimeSchema,
    weeklyIdeasCount: z.number().int().min(1).max(30),
    weeklyModes: z.array(contentModeSchema).max(7),
    githubRepo: githubRepoSchema.nullable(),
    githubBaseBranch: gitBranchSchema,
    weeklyPrEnabled: z.boolean(),
    approvalSlaHours: z.number().int().min(1).max(720),
    utmCampaignPrefix: utmPrefixSchema.nullable(),
    trackingBaseUrl: z
      .url({ protocol: /^https?$/ })
      .max(300)
      .nullable(),
    claudeMonthlyTokenCap: z.number().int().min(0).max(1_000_000_000).nullable(),
    autoSchedule: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
export type UpdateProductSettings = z.infer<typeof updateProductSettingsSchema>;

/** GET /products/:productId/settings: the settings plus what the screen needs around them. */
export const productSettingsDetailSchema = productSettingsSchema.extend({
  claudeUsage: z.object({
    month: z.string(),
    usedTokens: z.number().int().nonnegative(),
    capTokens: z.number().int().nonnegative(),
  }),
  features: z.object({ claude: z.boolean(), github: z.boolean(), storage: z.boolean() }),
  /** True when the signed-in user may edit (product owner or admin). */
  canEdit: z.boolean(),
});
export type ProductSettingsDetail = z.infer<typeof productSettingsDetailSchema>;

/* ---------- Posting slots ---------- */

export const MAX_POSTING_SLOTS = 100;

export const postingSlotInputSchema = z.object({
  platform: platformSchema,
  weekday: weekdaySchema,
  localTime: localTimeSchema,
  audienceTimezone: timeZoneSchema,
  label: z.string().trim().max(60).nullable().optional(),
  active: z.boolean().default(true),
});
export type PostingSlotInput = z.input<typeof postingSlotInputSchema>;

/** PUT /products/:productId/slots replaces the whole list (order = sort). */
export const replacePostingSlotsSchema = z
  .object({ slots: z.array(postingSlotInputSchema).max(MAX_POSTING_SLOTS) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.slots.forEach((s, i) => {
      const key = `${s.platform}|${s.weekday}|${s.localTime}|${s.audienceTimezone}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['slots', i],
          message: 'This slot is listed twice',
        });
      }
      seen.add(key);
    });
  });
export type ReplacePostingSlots = z.input<typeof replacePostingSlotsSchema>;

export const postingSlotListSchema = listResponseSchema(postingSlotSchema);

/** GET /products/:productId/slots/next?platform&count&from */
export const nextSlotsQuerySchema = z.object({
  platform: platformSchema.optional(),
  count: z.coerce.number().int().min(1).max(50).default(10),
  from: isoDateTimeSchema.optional(),
});
export type NextSlotsQuery = z.infer<typeof nextSlotsQuerySchema>;

export const nextSlotSchema = z.object({
  slotId: uuidSchema,
  platform: platformSchema,
  /** UTC instant. */
  at: isoDateTimeSchema,
  audienceTimezone: z.string(),
  label: z.string().nullable(),
});
export type NextSlot = z.infer<typeof nextSlotSchema>;
export const nextSlotListSchema = z.object({
  items: z.array(nextSlotSchema),
  launchDate: isoDateSchema.nullable(),
});
export type NextSlotList = z.infer<typeof nextSlotListSchema>;

/* ---------- Product channels ---------- */

/** One connected (or connectable) channel account as seen from a product. */
export const productChannelViewSchema = z.object({
  channelAccountId: uuidSchema,
  platform: platformSchema,
  displayName: z.string(),
  handle: z.string().nullable(),
  status: channelStatusSchema,
  /** True when the account belongs to every product (not tied to one). */
  shared: z.boolean(),
  enabled: z.boolean(),
  defaultLanguages: z.array(languageSchema),
  defaultRatio: ratioSchema.nullable(),
  /** True when a product_channels row exists (otherwise defaults are shown). */
  configured: z.boolean(),
});
export type ProductChannelView = z.infer<typeof productChannelViewSchema>;
export const productChannelListSchema = listResponseSchema(productChannelViewSchema);

export const productChannelInputSchema = z.object({
  channelAccountId: uuidSchema,
  enabled: z.boolean(),
  defaultLanguages: z.array(languageSchema).max(2),
  defaultRatio: ratioSchema.nullable(),
});
export type ProductChannelInput = z.infer<typeof productChannelInputSchema>;

/** PUT /products/:productId/channels replaces the product's channel choices. */
export const replaceProductChannelsSchema = z
  .object({ channels: z.array(productChannelInputSchema).max(50) })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.channels.map((c) => c.channelAccountId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['channels'], message: 'A channel is listed twice' });
    }
  });
export type ReplaceProductChannels = z.infer<typeof replaceProductChannelsSchema>;

/* ---------- Knowledge documents ---------- */

export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'text/html',
] as const;
export const documentMimeTypeSchema = z.enum(DOCUMENT_MIME_TYPES);
export type DocumentMimeType = z.infer<typeof documentMimeTypeSchema>;

const docTitle = z.string().trim().min(1).max(160);

/** POST /products/:productId/documents (one of three kinds). */
export const createProductDocumentSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('file'),
      title: docTitle.optional(),
      fileName: z.string().trim().min(1).max(200),
      mimeType: documentMimeTypeSchema,
      sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
      pinned: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('url'),
      title: docTitle.optional(),
      url: z.url({ protocol: /^https?$/ }).max(2000),
      pinned: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('note'),
      title: docTitle,
      text: z.string().trim().min(1).max(50_000),
      pinned: z.boolean().optional(),
    })
    .strict(),
]);
export type CreateProductDocument = z.infer<typeof createProductDocumentSchema>;

export const documentUploadSchema = z.object({
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresIn: z.number().int().positive(),
});
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

export const createProductDocumentResponseSchema = z.object({
  document: productDocumentSchema,
  /** Present for `file`: PUT the bytes here, then POST /documents/:id/complete. */
  upload: documentUploadSchema.nullable(),
});
export type CreateProductDocumentResponse = z.infer<typeof createProductDocumentResponseSchema>;

export const updateProductDocumentSchema = z
  .object({ title: docTitle, pinned: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Send at least one field' });
export type UpdateProductDocument = z.infer<typeof updateProductDocumentSchema>;

export const productDocumentListQuerySchema = paginationQuerySchema;
export const productDocumentListSchema = listResponseSchema(productDocumentSchema);

export const syncRepoSpecsResponseSchema = z.object({
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type SyncRepoSpecsResponse = z.infer<typeof syncRepoSpecsResponseSchema>;

/* ---------- Weekly runs ---------- */

export const weeklyRunListQuerySchema = paginationQuerySchema;
export const weeklyRunListSchema = listResponseSchema(weeklyRunSchema);

/* ---------- Schedule calendar ---------- */

export const MAX_SCHEDULE_RANGE_DAYS = 62;

export const scheduleQuerySchema = z
  .object({
    productId: uuidSchema,
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .refine((v) => Date.parse(v.to) > Date.parse(v.from), {
    message: '`to` must be after `from`',
    path: ['to'],
  })
  .refine(
    (v) => Date.parse(v.to) - Date.parse(v.from) <= MAX_SCHEDULE_RANGE_DAYS * 24 * 3600 * 1000,
    { message: `Ask for ${MAX_SCHEDULE_RANGE_DAYS} days or fewer`, path: ['to'] },
  );
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

export const scheduleItemSchema = z.object({
  postId: uuidSchema,
  briefId: uuidSchema,
  briefCode: z.string(),
  briefTitle: z.string(),
  platform: platformSchema,
  channelName: z.string(),
  status: postStatusSchema,
  /** When it goes (or went) out: published time when published, else scheduled time. */
  at: isoDateTimeSchema,
  audienceTimezone: z.string(),
  liveUrl: z.string().nullable(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

export const scheduleResponseSchema = z.object({
  items: z.array(scheduleItemSchema),
  /** Open posting slots in the range (future only, never before launch date). */
  freeSlots: z.array(nextSlotSchema),
  timezone: z.string(),
  launchDate: isoDateSchema.nullable(),
});
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
