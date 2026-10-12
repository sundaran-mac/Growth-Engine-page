/**
 * Health contract for `GET /api/v1/health`.
 */
import { z } from 'zod';
import { featureFlagsSchema, isoDateTimeSchema } from './common.js';

export const componentHealthSchema = z.object({
  status: z.enum(['up', 'down', 'disabled']),
  latencyMs: z.number().nonnegative().nullable(),
  detail: z.string().nullable(),
});
export type ComponentHealth = z.infer<typeof componentHealthSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  time: isoDateTimeSchema,
  checks: z.object({
    database: componentHealthSchema,
    storage: componentHealthSchema,
    queue: componentHealthSchema,
  }),
  features: featureFlagsSchema,
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;
