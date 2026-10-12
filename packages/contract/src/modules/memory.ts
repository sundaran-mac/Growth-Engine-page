/**
 * Content memory contract (BUILD-PLAN section 11, ADR 0009).
 * Every idea, brief hook, published caption and dropped Claude draft is remembered, for all
 * products, so nothing is suggested or posted twice.
 *
 *   POST /memory/check   check a title (and hook or caption) before saving
 *   GET  /memory/stats   how big the memory is, and whether meaning checks are on
 */
import { z } from 'zod';
import { memoryMatchSchema, uuidSchema } from '../common.js';
import { MEMORY_SOURCE_TYPES, memoryStatusSchema } from '../enums.js';

export const MEMORY_CHECK_TEXT_MAX = 2_200;

/** What is being checked. It decides which earlier rows count. */
export const MEMORY_CHECK_KINDS = ['idea', 'brief_hook', 'post_caption'] as const;
export const memoryCheckKindSchema = z.enum(MEMORY_CHECK_KINDS);
export type MemoryCheckKind = z.infer<typeof memoryCheckKindSchema>;

export const memoryCheckRequestSchema = z.object({
  productId: uuidSchema,
  kind: memoryCheckKindSchema,
  title: z.string().trim().min(1, 'Required').max(MEMORY_CHECK_TEXT_MAX),
  /** Hook of a brief, caption of a post, or the "why" of an idea. */
  body: z.string().trim().max(MEMORY_CHECK_TEXT_MAX).nullable().optional(),
  /** The idea being edited (its own memory row is skipped). */
  excludeIdeaId: uuidSchema.optional(),
  /** The brief being edited (its own hook and captions, and its idea, are skipped). */
  excludeBriefId: uuidSchema.optional(),
});
export type MemoryCheckRequest = z.input<typeof memoryCheckRequestSchema>;

export const memoryCheckResultSchema = z.object({
  status: memoryStatusSchema,
  matches: z.array(memoryMatchSchema),
});
export type MemoryCheckResult = z.infer<typeof memoryCheckResultSchema>;

export const memoryStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  bySourceType: z.record(z.enum(MEMORY_SOURCE_TYPES), z.number().int().nonnegative()),
  withEmbedding: z.number().int().nonnegative(),
  embeddings: z.object({
    enabled: z.boolean(),
    model: z.string().nullable(),
  }),
  thresholds: z.object({
    textDuplicate: z.number(),
    textSimilar: z.number(),
    meaningDuplicate: z.number(),
    meaningSimilar: z.number(),
  }),
  lastAddedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type MemoryStats = z.infer<typeof memoryStatsSchema>;
