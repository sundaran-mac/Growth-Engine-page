/**
 * MAKE routes (mounted at /api/v1). Every route needs a session; product access is checked in
 * the services from the brief's product (read: product member or editor; write: owner, backup,
 * maker or editor). Every mutation writes the audit log.
 *
 *   GET    /briefs?productId&stage&q            list
 *   POST   /briefs                              create (stage brief)
 *   GET    /briefs/:id                          one brief
 *   PATCH  /briefs/:id                          autosave (409 VERSION_CONFLICT when stale)
 *   GET    /briefs/:id/options                  people the editor can pick
 *   POST   /briefs/:id/claim-check              check a draft (preview) or the stored brief (saved)
 *   POST   /briefs/:id/assist                   Claude drafts (not stored)
 *   POST   /briefs/:id/freeze | unfreeze | send-for-review
 *   GET    /briefs/:id/assets                   files of the brief
 *   POST   /assets/uploads                      start an upload (presigned PUT or multipart)
 *   POST   /assets/:id/complete | abort
 *   GET    /assets/:id/url                      presigned GET
 *   PATCH  /assets/:id                          loudness (LUFS), licence, consent, AI label
 *   DELETE /assets/:id
 *   GET    /briefs/:id/render-jobs, POST /briefs/:id/render-jobs, PATCH /render-jobs/:id
 *   GET    /handoff-tools
 */
import { Router, type Request, type Response } from 'express';
import {
  assistRequestSchema,
  briefListQuerySchema,
  briefVersionBodySchema,
  claimCheckRequestSchema,
  completeUploadSchema,
  createBriefSchema,
  createRenderJobSchema,
  createUploadSchema,
  idParamSchema,
  updateBriefSchema,
  updateRenderJobSchema,
  updateAssetSchema,
  type UpdateAssetInput,
  type AssistRequest,
  type BriefListQuery,
  type BriefVersionBody,
  type ClaimCheckRequest,
  type CompleteUploadInput,
  type IdParam,
  type UpdateBriefInput,
  type UpdateRenderJobInput,
} from '@growth-desk/contract';
import type { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { actorOf } from './access.js';
import { assistBrief } from './assist.js';
import {
  abortUpload,
  assetUrl,
  completeUpload,
  createUpload,
  deleteAsset,
  listAssets,
  updateAsset,
} from './assets.service.js';
import {
  claimCheckBrief,
  createBrief,
  freezeBrief,
  getBrief,
  getBriefOptions,
  listBriefs,
  sendForReview,
  unfreezeBrief,
  updateBrief,
} from './briefs.service.js';
import {
  createRenderJob,
  handoffTools,
  listRenderJobs,
  updateRenderJob,
} from './render-jobs.service.js';

export const makeRouter: Router = Router();

const byId = validate({ params: idParamSchema });
const id = (req: Request) => parsed<unknown, unknown, IdParam>(req).params.id;

/* ---------- Briefs ---------- */

makeRouter.get('/briefs', requireAuth, validate({ query: briefListQuerySchema }), async (req, res) => {
  const q = parsed<unknown, BriefListQuery>(req).query;
  res.json(await listBriefs(await actorOf(req), q));
});

makeRouter.post('/briefs', requireAuth, validate({ body: createBriefSchema }), async (req, res) => {
  const body = parsed<z.output<typeof createBriefSchema>>(req).body;
  res.status(201).json(await createBrief(await actorOf(req), body));
});

makeRouter.get('/briefs/:id', requireAuth, byId, async (req, res) => {
  res.json(await getBrief(await actorOf(req), id(req)));
});

makeRouter.patch(
  '/briefs/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updateBriefSchema }),
  async (req, res) => {
    const body = parsed<UpdateBriefInput>(req).body;
    res.json(await updateBrief(await actorOf(req), id(req), body));
  },
);

makeRouter.get('/briefs/:id/options', requireAuth, byId, async (req, res) => {
  res.json(await getBriefOptions(await actorOf(req), id(req)));
});

makeRouter.post(
  '/briefs/:id/claim-check',
  requireAuth,
  validate({ params: idParamSchema, body: claimCheckRequestSchema }),
  async (req, res) => {
    const body = parsed<ClaimCheckRequest>(req).body;
    res.json(await claimCheckBrief(await actorOf(req), id(req), body));
  },
);

makeRouter.post(
  '/briefs/:id/assist',
  requireAuth,
  validate({ params: idParamSchema, body: assistRequestSchema }),
  async (req, res) => {
    const { kind } = parsed<AssistRequest>(req).body;
    res.json(await assistBrief(await actorOf(req), id(req), kind));
  },
);

const stageAction = (fn: typeof freezeBrief) =>
  [
    requireAuth,
    validate({ params: idParamSchema, body: briefVersionBodySchema }),
    async (req: Request, res: Response) => {
      const { version } = parsed<BriefVersionBody>(req).body;
      res.json(await fn(await actorOf(req), id(req), version));
    },
  ] as const;

makeRouter.post('/briefs/:id/freeze', ...stageAction(freezeBrief));
makeRouter.post('/briefs/:id/unfreeze', ...stageAction(unfreezeBrief));
makeRouter.post('/briefs/:id/send-for-review', ...stageAction(sendForReview));

/* ---------- Assets ---------- */

makeRouter.get('/briefs/:id/assets', requireAuth, byId, async (req, res) => {
  res.json(await listAssets(await actorOf(req), id(req)));
});

makeRouter.post('/assets/uploads', requireAuth, validate({ body: createUploadSchema }), async (req, res) => {
  const body = parsed<z.output<typeof createUploadSchema>>(req).body;
  res.status(201).json(await createUpload(await actorOf(req), body));
});

makeRouter.post(
  '/assets/:id/complete',
  requireAuth,
  validate({ params: idParamSchema, body: completeUploadSchema }),
  async (req, res) => {
    const body = parsed<CompleteUploadInput>(req).body;
    res.json(await completeUpload(await actorOf(req), id(req), body));
  },
);

makeRouter.post('/assets/:id/abort', requireAuth, byId, async (req, res) => {
  await abortUpload(await actorOf(req), id(req));
  res.status(204).end();
});

makeRouter.get('/assets/:id/url', requireAuth, byId, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await assetUrl(await actorOf(req), id(req)));
});

makeRouter.patch(
  '/assets/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updateAssetSchema }),
  async (req, res) => {
    const body = parsed<UpdateAssetInput>(req).body;
    res.json(await updateAsset(await actorOf(req), id(req), body));
  },
);

makeRouter.delete('/assets/:id', requireAuth, byId, async (req, res) => {
  await deleteAsset(await actorOf(req), id(req));
  res.status(204).end();
});

/* ---------- Render jobs ---------- */

makeRouter.get('/briefs/:id/render-jobs', requireAuth, byId, async (req, res) => {
  res.json(await listRenderJobs(await actorOf(req), id(req)));
});

makeRouter.post(
  '/briefs/:id/render-jobs',
  requireAuth,
  validate({ params: idParamSchema, body: createRenderJobSchema }),
  async (req, res) => {
    const body = parsed<z.output<typeof createRenderJobSchema>>(req).body;
    res.status(201).json(await createRenderJob(await actorOf(req), id(req), body));
  },
);

makeRouter.patch(
  '/render-jobs/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updateRenderJobSchema }),
  async (req, res) => {
    const body = parsed<UpdateRenderJobInput>(req).body;
    res.json(await updateRenderJob(await actorOf(req), id(req), body));
  },
);

/* ---------- Hand-off tools ---------- */

makeRouter.get('/handoff-tools', requireAuth, (_req, res) => {
  res.json({ items: handoffTools() });
});
