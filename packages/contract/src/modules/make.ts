/**
 * Module contract for the MAKE module (briefs, claim check, Claude co-writer, assets, render jobs).
 * Owned by the MAKE module agent. Re-exported from the package root, so names are unique.
 */
import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common.js';
import { similarReasonSchema } from './ideas.js';
import {
  assetSchema,
  briefClaimSchema,
  briefSchema,
  claimFlagSchema,
  claudeSuggestionsSchema,
  renderJobSchema,
  userRefSchema,
  type Brief,
} from '../entities.js';
import {
  assetKindSchema,
  briefKindSchema,
  briefStageSchema,
  contentModeSchema,
  languageSchema,
  platformSchema,
  ratioSchema,
  renderJobKindSchema,
  renderJobStatusSchema,
  type AssetKind,
  type BriefStage,
  type RenderJobStatus,
} from '../enums.js';

/* ---------- Limits ---------- */

export const BRIEF_TITLE_MAX = 160;
export const BRIEF_TEXT_MAX = 600;
export const BRIEF_BEATS_MAX = 12;

/** Stages in which hook, beats, ask and the side fields can still change. */
export const BRIEF_EDITABLE_STAGES: readonly BriefStage[] = ['idea', 'brief'];
/** Stages in which the Studio accepts uploads, render jobs and asset changes. */
export const BRIEF_MAKING_STAGES: readonly BriefStage[] = ['frozen', 'made'];

export function isBriefEditable(stage: BriefStage): boolean {
  return BRIEF_EDITABLE_STAGES.includes(stage);
}
export function isBriefMaking(stage: BriefStage): boolean {
  return BRIEF_MAKING_STAGES.includes(stage);
}

/* ---------- Briefs ---------- */

const briefText = z.string().trim().max(BRIEF_TEXT_MAX);
const optionalText = briefText.nullable();

export const briefListQuerySchema = z.object({
  productId: uuidSchema,
  /** One stage or a comma list, for example `frozen,made` (Studio picker). */
  stage: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      const parts = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
      const out: BriefStage[] = [];
      for (const p of parts) {
        const r = briefStageSchema.safeParse(p);
        if (!r.success) {
          ctx.addIssue({ code: 'custom', message: `Unknown stage: ${p}` });
          return z.NEVER;
        }
        out.push(r.data);
      }
      return out;
    }),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type BriefListQuery = z.infer<typeof briefListQuerySchema>;

export const createBriefSchema = z.object({
  productId: uuidSchema,
  title: z.string().trim().min(1).max(BRIEF_TITLE_MAX),
  kind: briefKindSchema.default('reel'),
  mode: contentModeSchema,
  channels: z.array(platformSchema).max(5).default([]),
  /** Optional first hook. Title and hook are checked against the content memory. */
  hook: optionalText.optional(),
  /** Needed only when the brief is similar to earlier content (409 IDEA_SIMILAR). */
  similarReason: similarReasonSchema.optional(),
});
export type CreateBriefInput = z.input<typeof createBriefSchema>;

/**
 * Autosave body. `version` and `updatedAt` come from the brief the editor loaded; when either
 * no longer matches, the API answers 409 `VERSION_CONFLICT` and nothing is written.
 */
export const updateBriefSchema = z
  .object({
    version: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
    title: z.string().trim().min(1).max(BRIEF_TITLE_MAX).optional(),
    mode: contentModeSchema.optional(),
    hook: optionalText.optional(),
    beats: z.array(briefText).max(BRIEF_BEATS_MAX).optional(),
    ask: optionalText.optional(),
    ratios: z.array(ratioSchema).max(4).optional(),
    captionLanguages: z.array(languageSchema).max(2).optional(),
    channels: z.array(platformSchema).max(5).optional(),
    ownerId: uuidSchema.nullable().optional(),
    claimsApproverId: uuidSchema.nullable().optional(),
    brandApproverId: uuidSchema.nullable().optional(),
    /** Accepted Claude content (captions per language, b-roll list, kept alternative hooks). */
    claudeSuggestions: claudeSuggestionsSchema.optional(),
  })
  .refine(
    (b) =>
      Object.keys(b).some((k) => k !== 'version' && k !== 'updatedAt'),
    { message: 'Nothing to update.' },
  );
export type UpdateBriefInput = z.input<typeof updateBriefSchema>;

/** Body for stage actions that must act on the version the user saw. */
export const briefVersionBodySchema = z.object({
  version: z.number().int().positive(),
});
export type BriefVersionBody = z.infer<typeof briefVersionBodySchema>;

export const briefListResponseSchema = z.object({
  items: z.array(briefSchema),
  total: z.number().int().nonnegative(),
});
export type BriefListResponse = z.infer<typeof briefListResponseSchema>;

/** People the brief editor can pick: owner, claims approver (owner or backup), brand approver. */
export const briefOptionsSchema = z.object({
  owners: z.array(userRefSchema),
  claimsApprovers: z.array(userRefSchema),
  brandApprovers: z.array(userRefSchema),
});
export type BriefOptions = z.infer<typeof briefOptionsSchema>;

/* ---------- Claim check ---------- */

/**
 * Optional draft text. With a draft, the check is a preview of unsaved text and nothing is stored.
 * Without a draft, the stored brief is checked again and the result is saved on the brief.
 */
export const claimCheckRequestSchema = z.object({
  draft: z
    .object({
      title: z.string().max(BRIEF_TITLE_MAX).optional(),
      hook: briefText.nullable().optional(),
      beats: z.array(briefText).max(BRIEF_BEATS_MAX).optional(),
      ask: briefText.nullable().optional(),
    })
    .optional(),
});
export type ClaimCheckRequest = z.infer<typeof claimCheckRequestSchema>;

export const claimCheckResultSchema = z.object({
  flags: z.array(claimFlagSchema),
  claims: z.array(briefClaimSchema),
  /** True when any flag is `fail` (red). Freeze is refused while true. */
  blocking: z.boolean(),
  /** Kit version the check used, or null when the product has no kit. */
  kitVersion: z.number().int().positive().nullable(),
  stored: z.boolean(),
  checkedAt: isoDateTimeSchema,
});
export type ClaimCheckResult = z.infer<typeof claimCheckResultSchema>;

/* ---------- Claude co-writer ---------- */

export const ASSIST_KINDS = ['tamil_caption', 'alt_hooks', 'broll'] as const;
export const assistKindSchema = z.enum(ASSIST_KINDS);
export type AssistKind = z.infer<typeof assistKindSchema>;

export const ASSIST_KIND_LABELS: Record<AssistKind, string> = {
  tamil_caption: 'Tamil caption',
  alt_hooks: 'Alternative hooks',
  broll: 'B-roll list',
};

export const assistRequestSchema = z.object({ kind: assistKindSchema });
export type AssistRequest = z.infer<typeof assistRequestSchema>;

/**
 * Drafts from Claude. Nothing is applied to the brief: the editor accepts or dismisses each one,
 * and an accepted item is saved with the normal PATCH (hook, or `claudeSuggestions`).
 */
export const assistResponseSchema = z.object({
  kind: assistKindSchema,
  suggestions: z.array(z.object({ text: z.string(), language: languageSchema.nullable() })),
  /** Drafts dropped because they used a never-say or not-built phrase. */
  dropped: z.number().int().nonnegative(),
  generatedAt: isoDateTimeSchema,
});
export type AssistResponse = z.infer<typeof assistResponseSchema>;

/* ---------- Assets and uploads ---------- */

export const MiB_BYTES = 1024 * 1024;
/** Files above this size go through multipart upload. */
export const UPLOAD_SINGLE_MAX_BYTES = 50 * MiB_BYTES;
/** Smallest multipart part we hand out (S3 needs 5 MiB; we use 10 MiB). */
export const UPLOAD_MIN_PART_BYTES = 10 * MiB_BYTES;
export const UPLOAD_MAX_PARTS = 10_000;

export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const CAPTION_MIME_TYPES = ['text/vtt', 'application/x-subrip'] as const;
export const ASSET_MIME_TYPES = [
  ...VIDEO_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...CAPTION_MIME_TYPES,
] as const;
export const assetMimeTypeSchema = z.enum(ASSET_MIME_TYPES);
export type AssetMimeType = z.infer<typeof assetMimeTypeSchema>;

/** File name extensions allowed for each mime type. */
export const MIME_EXTENSIONS: Record<AssetMimeType, readonly string[]> = {
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov', 'qt'],
  'video/webm': ['webm'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'text/vtt': ['vtt'],
  'application/x-subrip': ['srt'],
};

/** Which mime types each asset kind takes, and its size cap in bytes. */
export const ASSET_KIND_RULES: Record<AssetKind, { mimeTypes: readonly AssetMimeType[]; maxBytes: number }> = {
  video: { mimeTypes: VIDEO_MIME_TYPES, maxBytes: 2 * 1024 * MiB_BYTES },
  cutdown: { mimeTypes: VIDEO_MIME_TYPES, maxBytes: 2 * 1024 * MiB_BYTES },
  poster: { mimeTypes: IMAGE_MIME_TYPES, maxBytes: 50 * MiB_BYTES },
  caption: { mimeTypes: CAPTION_MIME_TYPES, maxBytes: 5 * MiB_BYTES },
};

export function fileExtension(fileName: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Null when the file fits the kind; otherwise a short reason for the user. */
export function checkUploadFile(input: {
  kind: AssetKind;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
}): string | null {
  const rules = ASSET_KIND_RULES[input.kind];
  const mime = assetMimeTypeSchema.safeParse(input.mimeType);
  if (!mime.success || !rules.mimeTypes.includes(mime.data)) {
    return `This file type is not allowed here. Use: ${rules.mimeTypes.join(', ')}.`;
  }
  if (!MIME_EXTENSIONS[mime.data].includes(fileExtension(input.fileName))) {
    return 'The file name extension does not match the file type.';
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return 'The file is empty.';
  if (input.sizeBytes > rules.maxBytes) {
    return `The file is too large. The limit is ${Math.round(rules.maxBytes / MiB_BYTES)} MB.`;
  }
  return null;
}

/** Part size for a multipart upload: at least 10 MiB, whole MiB, at most 10,000 parts. */
export function uploadPartSize(totalBytes: number): number {
  const needed = Math.ceil(totalBytes / UPLOAD_MAX_PARTS);
  return Math.max(UPLOAD_MIN_PART_BYTES, Math.ceil(needed / MiB_BYTES) * MiB_BYTES);
}

/** Integrated loudness in LUFS, one decimal, between -70 and 0 (target -14). */
export const loudnessLufsSchema = z
  .number()
  .min(-70)
  .max(0)
  .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-9, { message: 'Use one decimal, for example -14.0' });

/** Asset as MAKE returns it: the shared asset record, with loudness kept to one decimal. */
export const makeAssetSchema = assetSchema.extend({ loudnessLufs: loudnessLufsSchema.nullable() });
export type MakeAsset = z.infer<typeof makeAssetSchema>;

/** Studio edits to a file's metadata (manual loudness for v1, licence, consent, AI label). */
export const updateAssetSchema = z
  .object({
    loudnessLufs: loudnessLufsSchema.nullable().optional(),
    licence: z.string().trim().max(300).nullable().optional(),
    consentOnFile: z.boolean().optional(),
    aiGenerated: z.boolean().optional(),
    /** Null only for a caption file; video, cut-down and poster files need a ratio. */
    ratio: ratioSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

export const createUploadSchema = z
  .object({
    briefId: uuidSchema,
    kind: assetKindSchema,
    ratio: ratioSchema.nullable().default(null),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.string().trim().min(1).max(100),
    sizeBytes: z.number().int().positive(),
    durationMs: z.number().int().nonnegative().max(24 * 3600 * 1000).nullable().default(null),
    width: z.number().int().positive().max(20_000).nullable().default(null),
    height: z.number().int().positive().max(20_000).nullable().default(null),
    licence: z.string().trim().max(300).nullable().default(null),
    consentOnFile: z.boolean().default(false),
    aiGenerated: z.boolean().default(false),
    loudnessLufs: loudnessLufsSchema.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const reason = checkUploadFile(v);
    if (reason) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: reason });
  });
export type CreateUploadInput = z.input<typeof createUploadSchema>;

export const uploadPlanSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('single'),
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
    expiresIn: z.number().int().positive(),
  }),
  z.object({
    mode: z.literal('multipart'),
    partSize: z.number().int().positive(),
    parts: z.array(z.object({ partNumber: z.number().int().positive(), url: z.string() })),
    expiresIn: z.number().int().positive(),
  }),
]);
export type UploadPlan = z.infer<typeof uploadPlanSchema>;

export const createUploadResponseSchema = z.object({
  asset: makeAssetSchema,
  upload: uploadPlanSchema,
});
export type CreateUploadResponse = z.infer<typeof createUploadResponseSchema>;

export const completeUploadSchema = z.object({
  /** Required for multipart uploads: every part with the ETag the storage returned. */
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(UPLOAD_MAX_PARTS),
        etag: z.string().min(1).max(200),
      }),
    )
    .max(UPLOAD_MAX_PARTS)
    .optional(),
});
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;

export const assetListResponseSchema = z.object({
  items: z.array(makeAssetSchema),
  total: z.number().int().nonnegative(),
});
export type AssetListResponse = z.infer<typeof assetListResponseSchema>;

export const assetUrlResponseSchema = z.object({
  url: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AssetUrlResponse = z.infer<typeof assetUrlResponseSchema>;

/* ---------- Render jobs (hand-off records) ---------- */

/** Allowed render job status moves. `running -> running` is a progress update. */
export const RENDER_JOB_TRANSITIONS: Record<RenderJobStatus, readonly RenderJobStatus[]> = {
  queued: ['running', 'done', 'failed', 'cancelled'],
  running: ['running', 'done', 'failed', 'cancelled'],
  failed: ['queued'],
  cancelled: ['queued'],
  done: [],
};

export function canMoveRenderJob(from: RenderJobStatus, to: RenderJobStatus): boolean {
  return RENDER_JOB_TRANSITIONS[from].includes(to);
}

export const createRenderJobSchema = z.object({
  kind: renderJobKindSchema,
  label: z.string().trim().min(1).max(120),
  tool: z.string().trim().min(1).max(60).nullable().default(null),
  assetId: uuidSchema.nullable().default(null),
});
export type CreateRenderJobInput = z.input<typeof createRenderJobSchema>;

export const updateRenderJobSchema = z
  .object({
    status: renderJobStatusSchema.optional(),
    progress: z.number().int().min(0).max(100).optional(),
    error: z.string().trim().min(1).max(500).nullable().optional(),
    label: z.string().trim().min(1).max(120).optional(),
    /** The uploaded result. A ready asset of the same brief marks the job done. */
    assetId: uuidSchema.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update.' });
export type UpdateRenderJobInput = z.infer<typeof updateRenderJobSchema>;

export const renderJobListResponseSchema = z.object({
  items: z.array(renderJobSchema),
  total: z.number().int().nonnegative(),
});
export type RenderJobListResponse = z.infer<typeof renderJobListResponseSchema>;

/* ---------- Hand-off tools ---------- */

export const HANDOFF_TOOL_KEYS = ['figma', 'capcut', 'adobe-express', 'reel-studio'] as const;
export const handoffToolKeySchema = z.enum(HANDOFF_TOOL_KEYS);
export type HandoffToolKey = z.infer<typeof handoffToolKeySchema>;

export const handoffToolSchema = z.object({
  key: handoffToolKeySchema,
  name: z.string(),
  description: z.string(),
  /** Null when no URL is set up for this tool. */
  url: z.string().nullable(),
});
export type HandoffTool = z.infer<typeof handoffToolSchema>;

export const handoffToolListSchema = z.object({ items: z.array(handoffToolSchema) });
export type HandoffToolList = z.infer<typeof handoffToolListSchema>;

/* ---------- Helpers shared by API and web ---------- */

/** Asset kinds that count as the master for a brief kind ("Send for review" needs one ready). */
export function masterAssetKinds(kind: Brief['kind']): readonly AssetKind[] {
  return kind === 'reel' || kind === 'short' ? ['video'] : ['poster', 'video'];
}

