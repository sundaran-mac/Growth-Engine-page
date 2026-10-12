/**
 * IDEAS module routes (mounted at /api/v1):
 *
 *   GET    /ideas?productId&status&mode     list (board)            read
 *   GET    /ideas/board?productId           Claude status + weekly proposal   read
 *   POST   /ideas                           new idea by hand        write
 *   POST   /ideas/generate                  ideas from Claude       write
 *   PATCH  /ideas/:id                       edit                    write
 *   POST   /ideas/:id/star {starred}        star or unstar          write
 *   POST   /ideas/:id/park {reason}         park                    write
 *   POST   /ideas/:id/unpark                back to new             write
 *   POST   /ideas/:id/brief                 open as brief (MAKE)    write
 *   DELETE /ideas/:id                       delete                  delete (editor+)
 *   GET    /plans?productId&month           plan or null            read
 *   POST   /plans                           start a month           write
 *   GET    /plans/:id/checks                mix, occasions, warnings read
 *   POST   /plans/:id/items                 add a piece             write
 *   PATCH  /plan-items/:id                  move or edit a piece    write
 *   DELETE /plan-items/:id                  remove a piece          write
 *   POST   /plans/:id/freeze                freeze + briefs         freeze (editor or owner)
 *   POST   /plans/:id/unfreeze              unfreeze                admin
 *   GET    /occasions?from&to&productId     occasions in a range    signed in (read on product)
 *   POST   /occasions                       new occasion            editor+
 */
import { Router, type Request } from 'express';
import {
  idParamSchema,
  ideaCreateSchema,
  ideaGenerateSchema,
  ideaListQuerySchema,
  ideaParkSchema,
  ideaStarSchema,
  ideaUpdateSchema,
  ideasProductQuerySchema,
  occasionCreateSchema,
  occasionListQuerySchema,
  planCreateSchema,
  planItemCreateSchema,
  planItemUpdateSchema,
  planQuerySchema,
  type IdParam,
  type IdeaBoardInfo,
  type IdeaGenerateResponse,
  type IdeaListQuery,
  type IdeaOpenBriefResponse,
  type IdeasProductQuery,
  type OccasionListQuery,
  type PlanGetResponse,
  type PlanQuery,
} from '@growth-desk/contract';
import type { z } from 'zod';
import { auditContext } from '../../lib/audit.js';
import { getMonthlyUsage, isClaudeEnabled } from '../../lib/claude.js';
import { notFound } from '../../lib/errors.js';
import { toListResponse } from '../../lib/pagination.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { assertCan, requireIdeasAccess } from './access.js';
import { generateIdeasDetailed } from './generation.js';
import { findIdea, findPlan, findPlanItem, listIdeas, listOccasions, type IdeaRow, type PlanItemRow, type PlanRow } from './repo.js';
import {
  addPlanItem,
  createIdea,
  createOccasion,
  createPlan,
  deleteIdea,
  deletePlanItem,
  freezePlan,
  getPlanView,
  latestWeeklyProposal,
  openIdeaAsBrief,
  parkIdea,
  planChecks,
  starIdea,
  unfreezePlan,
  unparkIdea,
  updateIdea,
  updatePlanItem,
} from './service.js';
import type { IdeasAction } from './access.js';

export const ideasRouter: Router = Router();

const idParams = validate({ params: idParamSchema });

function paramId(req: Request): string {
  return parsed<unknown, unknown, IdParam>(req).params.id;
}

async function loadIdea(req: Request, action: IdeasAction): Promise<IdeaRow> {
  const idea = await findIdea(paramId(req));
  if (!idea) throw notFound('Idea');
  await assertCan(req, idea.productId, action);
  return idea;
}

async function loadPlan(req: Request, action: IdeasAction): Promise<PlanRow> {
  const plan = await findPlan(paramId(req));
  if (!plan) throw notFound('Plan');
  await assertCan(req, plan.productId, action);
  return plan;
}

async function loadPlanItem(req: Request, action: IdeasAction): Promise<PlanItemRow> {
  const item = await findPlanItem(paramId(req));
  if (!item) throw notFound('Plan item');
  const plan = await findPlan(item.planId);
  if (!plan) throw notFound('Plan');
  await assertCan(req, plan.productId, action);
  return item;
}

/* ---------- Ideas ---------- */

ideasRouter.get(
  '/ideas',
  requireAuth,
  validate({ query: ideaListQuerySchema }),
  requireIdeasAccess('query', 'read'),
  async (req, res) => {
    const q = parsed<unknown, IdeaListQuery>(req).query;
    const { items, total } = await listIdeas(q);
    res.json(toListResponse(items, total));
  },
);

ideasRouter.get(
  '/ideas/board',
  requireAuth,
  validate({ query: ideasProductQuerySchema }),
  requireIdeasAccess('query', 'read'),
  async (req, res) => {
    const { productId } = parsed<unknown, IdeasProductQuery>(req).query;
    const [usage, weeklyProposal] = await Promise.all([getMonthlyUsage(productId), latestWeeklyProposal(productId)]);
    const body: IdeaBoardInfo = {
      claude: {
        enabled: isClaudeEnabled(),
        usedTokens: usage.inputTokens + usage.outputTokens,
        capTokens: usage.capTokens,
      },
      weeklyProposal,
    };
    res.json(body);
  },
);

ideasRouter.post(
  '/ideas',
  requireAuth,
  validate({ body: ideaCreateSchema }),
  requireIdeasAccess('body', 'write'),
  async (req, res) => {
    const body = req.body as z.infer<typeof ideaCreateSchema>;
    res.status(201).json(await createIdea(body, auditContext(req)));
  },
);

ideasRouter.post(
  '/ideas/generate',
  requireAuth,
  validate({ body: ideaGenerateSchema }),
  requireIdeasAccess('body', 'write'),
  async (req, res) => {
    const body = req.body as z.infer<typeof ideaGenerateSchema>;
    const result = await generateIdeasDetailed(
      body.productId,
      { count: body.count, modes: body.mode ? [body.mode] : undefined, channels: body.channels, source: 'manual' },
      req.user!.id,
    );
    const response: IdeaGenerateResponse = {
      items: result.ideas,
      dropped: result.dropped,
      droppedAsDuplicate: result.droppedAsDuplicate,
      rounds: result.rounds,
    };
    res.status(201).json(response);
  },
);

ideasRouter.patch('/ideas/:id', requireAuth, idParams, validate({ body: ideaUpdateSchema }), async (req, res) => {
  const idea = await loadIdea(req, 'write');
  res.json(await updateIdea(idea, req.body as z.infer<typeof ideaUpdateSchema>, auditContext(req)));
});

ideasRouter.post('/ideas/:id/star', requireAuth, idParams, validate({ body: ideaStarSchema }), async (req, res) => {
  const idea = await loadIdea(req, 'write');
  const { starred } = req.body as z.infer<typeof ideaStarSchema>;
  res.json(await starIdea(idea, starred, auditContext(req)));
});

ideasRouter.post('/ideas/:id/park', requireAuth, idParams, validate({ body: ideaParkSchema }), async (req, res) => {
  const idea = await loadIdea(req, 'write');
  const { reason } = req.body as z.infer<typeof ideaParkSchema>;
  res.json(await parkIdea(idea, reason, auditContext(req)));
});

ideasRouter.post('/ideas/:id/unpark', requireAuth, idParams, async (req, res) => {
  const idea = await loadIdea(req, 'write');
  res.json(await unparkIdea(idea, auditContext(req)));
});

ideasRouter.post('/ideas/:id/brief', requireAuth, idParams, async (req, res) => {
  const idea = await loadIdea(req, 'write');
  const body: IdeaOpenBriefResponse = { brief: await openIdeaAsBrief(idea, req.user!.id) };
  res.status(201).json(body);
});

ideasRouter.delete('/ideas/:id', requireAuth, idParams, async (req, res) => {
  const idea = await loadIdea(req, 'delete');
  await deleteIdea(idea, auditContext(req));
  res.status(204).end();
});

/* ---------- Plans ---------- */

ideasRouter.get(
  '/plans',
  requireAuth,
  validate({ query: planQuerySchema }),
  requireIdeasAccess('query', 'read'),
  async (req, res) => {
    const { productId, month } = parsed<unknown, PlanQuery>(req).query;
    const body: PlanGetResponse = { plan: await getPlanView(productId, month) };
    res.json(body);
  },
);

ideasRouter.post(
  '/plans',
  requireAuth,
  validate({ body: planCreateSchema }),
  requireIdeasAccess('body', 'write'),
  async (req, res) => {
    const { productId, month } = req.body as z.infer<typeof planCreateSchema>;
    res.status(201).json(await createPlan(productId, month, auditContext(req)));
  },
);

ideasRouter.get('/plans/:id/checks', requireAuth, idParams, async (req, res) => {
  const plan = await loadPlan(req, 'read');
  res.json(await planChecks(plan));
});

ideasRouter.post('/plans/:id/items', requireAuth, idParams, validate({ body: planItemCreateSchema }), async (req, res) => {
  const plan = await loadPlan(req, 'write');
  const body = req.body as z.infer<typeof planItemCreateSchema>;
  res.status(201).json(await addPlanItem(plan.id, body, auditContext(req)));
});

ideasRouter.patch('/plan-items/:id', requireAuth, idParams, validate({ body: planItemUpdateSchema }), async (req, res) => {
  const item = await loadPlanItem(req, 'write');
  res.json(await updatePlanItem(item, req.body as z.infer<typeof planItemUpdateSchema>, auditContext(req)));
});

ideasRouter.delete('/plan-items/:id', requireAuth, idParams, async (req, res) => {
  const item = await loadPlanItem(req, 'write');
  await deletePlanItem(item, auditContext(req));
  res.status(204).end();
});

ideasRouter.post('/plans/:id/freeze', requireAuth, idParams, async (req, res) => {
  const plan = await loadPlan(req, 'freeze');
  res.json(await freezePlan(plan.id, req.user!.id, auditContext(req)));
});

ideasRouter.post('/plans/:id/unfreeze', requireAuth, requireRole('admin'), idParams, async (req, res) => {
  const plan = await loadPlan(req, 'unfreeze');
  res.json(await unfreezePlan(plan.id, auditContext(req)));
});

/* ---------- Occasions ---------- */

ideasRouter.get('/occasions', requireAuth, validate({ query: occasionListQuerySchema }), async (req, res) => {
  const q = parsed<unknown, OccasionListQuery>(req).query;
  if (q.productId) await assertCan(req, q.productId, 'read');
  const items = await listOccasions(q.from, q.to, q.productId);
  res.json(toListResponse(items, items.length));
});

ideasRouter.post(
  '/occasions',
  requireAuth,
  requireRole('admin', 'editor'),
  validate({ body: occasionCreateSchema }),
  async (req, res) => {
    const body = req.body as z.infer<typeof occasionCreateSchema>;
    res.status(201).json(await createOccasion(body, auditContext(req)));
  },
);
