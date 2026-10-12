/**
 * Content memory routes (mounted at /api/v1):
 *
 *   POST /memory/check   check a title, hook or caption before saving   read on the product
 *   GET  /memory/stats   size of the memory, embeddings on or off        signed in
 */
import { Router } from 'express';
import { memoryCheckRequestSchema, type MemoryCheckResult, type MemoryStats } from '@growth-desk/contract';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { requireIdeasAccess } from '../ideas/access.js';
import { checkContent, memoryStats } from './service.js';

export const memoryRouter: Router = Router();

memoryRouter.post(
  '/memory/check',
  requireAuth,
  validate({ body: memoryCheckRequestSchema }),
  requireIdeasAccess('body', 'read'),
  async (req, res) => {
    const body = req.body as z.infer<typeof memoryCheckRequestSchema>;
    const result: MemoryCheckResult = await checkContent({
      kind: body.kind,
      title: body.title,
      body: body.body ?? null,
      productId: body.productId,
      excludeIdeaId: body.excludeIdeaId,
      excludeBriefId: body.excludeBriefId,
    });
    res.json(result);
  },
);

memoryRouter.get('/memory/stats', requireAuth, async (_req, res) => {
  const body: MemoryStats = await memoryStats();
  res.json(body);
});
