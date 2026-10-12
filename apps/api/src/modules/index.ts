/**
 * Registers every module router under /api/v1. Owned by FOUNDATION-API (pre-created).
 * Module agents fill their own `modules/<module>/routes.ts` and never edit this file.
 */
import { Router } from 'express';
import { authRouter } from './auth/routes.js';
import { gatesRouter } from './gates/routes.js';
import { healthRouter } from './health/routes.js';
import { ideasRouter } from './ideas/routes.js';
import { insightsRouter } from './insights/routes.js';
import { makeRouter } from './make/routes.js';
import { memoryRouter } from './memory/routes.js';
import { productsRouter } from './products/routes.js';
import { publishRouter } from './publish/routes.js';
import { settingsRouter } from './settings/routes.js';

export const API_PREFIX = '/api/v1';

export function buildApiRouter(): Router {
  const api = Router();
  api.use(healthRouter);
  api.use(authRouter);
  api.use(productsRouter);
  api.use(ideasRouter);
  api.use(makeRouter);
  api.use(gatesRouter);
  api.use(publishRouter);
  api.use(insightsRouter);
  api.use(settingsRouter);
  api.use(memoryRouter);
  return api;
}
