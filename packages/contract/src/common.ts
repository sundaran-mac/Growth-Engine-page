/**
 * Shared building blocks: ids, dates, problem details, list responses, pagination.
 */
import { z } from 'zod';

/* ---------- Ids and dates ---------- */

export const uuidSchema = z.uuid();
export type Uuid = z.infer<typeof uuidSchema>;

/** Route param `{ id }` shape, reused by many modules. */
export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

/** ISO 8601 date-time string in UTC, for example `2026-10-13T14:00:00.000Z`. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/** Calendar date `YYYY-MM-DD` (plan days, occasions, metric snapshot dates). */
export const isoDateSchema = z.iso.date();
export type IsoDate = z.infer<typeof isoDateSchema>;

/** Calendar month `YYYY-MM` (plans, Claude usage). */
export const isoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export type IsoMonth = z.infer<typeof isoMonthSchema>;

/** IANA time zone name, for example `Asia/Kolkata`. */
export const timeZoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown time zone' },
);

/** Human brief code, for example `REEL-031`. */
export const briefCodeSchema = z.string().regex(/^[A-Z]+-\d{3,}$/, 'Use a code like REEL-031');

/** Spec reference in a product kit, for example `006` or `013-02`. */
export const specRefSchema = z.string().regex(/^\d{3}(-\d{2})?$/, 'Use a spec ref like 006');

/* ---------- Errors (RFC 7807) ---------- */

/** Stable error codes. Modules may add their own SCREAMING_SNAKE strings. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ORIGIN_NOT_ALLOWED',
  'INVALID_CREDENTIALS',
  'FEATURE_DISABLED',
  'CLAUDE_CAP_REACHED',
  'CLAUDE_FAILED',
  'STORAGE_FAILED',
  'CLAIM_CHECK_FAILED',
  'GATE_NOT_ALLOWED',
  'STAGE_NOT_ALLOWED',
  'IDEA_DUPLICATE',
  'IDEA_SIMILAR',
  'INTERNAL_ERROR',
] as const;
export type KnownErrorCode = (typeof ERROR_CODES)[number];

export const fieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldError = z.infer<typeof fieldErrorSchema>;

/**
 * One earlier piece of content that a new idea, hook or caption repeats (content memory,
 * ADR 0009). Sent in `matches` on 409 IDEA_DUPLICATE and IDEA_SIMILAR, and by the check
 * endpoint. `score` is 1 for a fingerprint match, else the trigram or cosine similarity.
 */
export const memoryMatchSchema = z.object({
  id: z.uuid(),
  sourceType: z.enum(['idea', 'brief_hook', 'post_caption', 'dropped_draft']),
  sourceId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  productName: z.string().nullable(),
  title: z.string(),
  body: z.string().nullable(),
  score: z.number().min(0).max(1),
  layer: z.enum(['fingerprint', 'text', 'meaning']),
  level: z.enum(['similar', 'duplicate']),
  createdAt: z.iso.datetime({ offset: true }),
});
export type MemoryMatch = z.infer<typeof memoryMatchSchema>;

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(fieldErrorSchema).optional(),
  /** Earlier content this one repeats (IDEA_DUPLICATE, IDEA_SIMILAR). */
  matches: z.array(memoryMatchSchema).optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/* ---------- Lists and pagination ---------- */

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function listResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.number().int().nonnegative() });
}
export interface ListResponse<T> {
  items: T[];
  total: number;
}

/** Simple `{ ok: true }` body for actions with nothing to return. */
export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

/** Feature flags the API reports so the web can show a clear "not set up" state. */
export const featureFlagsSchema = z.object({
  claude: z.boolean(),
  storage: z.boolean(),
  meta: z.boolean(),
  google: z.boolean(),
  linkedin: z.boolean(),
  github: z.boolean(),
  smtp: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;
