/**
 * INSIGHTS routes, mounted at /api/v1:
 *   GET  /dashboard                      Home (any signed-in user)
 *   GET  /analytics/summary|by-channel|by-mode|posts
 *   GET  /notes/latest, POST /notes/generate          (generate: admin, editor, owner, backup)
 *   GET  /leads, POST /leads, GET/PATCH /leads/:id, POST /leads/:id/move
 *   GET  /leads/:id/activities, POST /leads/:id/activities
 *   GET  /keyword-rules, POST /keyword-rules, PATCH /keyword-rules/:id, GET /keyword-events
 *   GET  /webhooks/meta, POST /webhooks/meta          (no session: Meta token and signature)
 *   GET  /notifications, POST /notifications/:id/read, POST /notifications/read-all
 */
import { Router } from 'express';
import type { z } from 'zod';
import {
  analyticsPostsQuerySchema,
  analyticsQuerySchema,
  createKeywordRuleRequestSchema,
  createLeadActivityRequestSchema,
  createLeadRequestSchema,
  dashboardQuerySchema,
  generateNoteRequestSchema,
  idParamSchema,
  latestNoteQuerySchema,
  listKeywordEventsQuerySchema,
  listKeywordRulesQuerySchema,
  listLeadsQuerySchema,
  listNotificationsQuerySchema,
  moveLeadRequestSchema,
  paginationQuerySchema,
  updateKeywordRuleRequestSchema,
  updateLeadRequestSchema,
  type IdParam,
} from '@growth-desk/contract';
import { auditContext, writeAudit } from '../../lib/audit.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { assertProductWriter, OWNER_ROLES } from './access.js';
import {
  analyticsByChannel,
  analyticsByMode,
  analyticsPosts,
  analyticsSummary,
} from './analytics.service.js';
import { buildDashboard } from './dashboard.service.js';
import {
  createKeywordRule,
  listKeywordEvents,
  listKeywordRules,
  updateKeywordRule,
} from './keywords.service.js';
import {
  addLeadActivity,
  createLead,
  getLeadView,
  listLeadActivities,
  listLeads,
  moveLead,
  updateLead,
} from './leads.service.js';
import { toWeeklyNote } from './mappers.js';
import { generateMondayNote, latestNote, thisWeekStart } from './notes.service.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications.service.js';
import { metaWebhookRouter } from './webhook.js';

export const insightsRouter: Router = Router();

/** Everyone except viewers may write; product rules are checked in the services. */
const writer = requireRole('editor', 'member');

// Webhooks first: they carry no session.
insightsRouter.use(metaWebhookRouter);

/* ---------- Dashboard ---------- */

insightsRouter.get(
  '/dashboard',
  requireAuth,
  validate({ query: dashboardQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof dashboardQuerySchema>>(req);
    res.json(await buildDashboard(req, query));
  },
);

/* ---------- Analytics ---------- */

type AnalyticsQ = z.output<typeof analyticsQuerySchema>;

insightsRouter.get(
  '/analytics/summary',
  requireAuth,
  validate({ query: analyticsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, AnalyticsQ>(req);
    res.json(await analyticsSummary(query));
  },
);

insightsRouter.get(
  '/analytics/by-channel',
  requireAuth,
  validate({ query: analyticsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, AnalyticsQ>(req);
    res.json(await analyticsByChannel(query));
  },
);

insightsRouter.get(
  '/analytics/by-mode',
  requireAuth,
  validate({ query: analyticsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, AnalyticsQ>(req);
    res.json(await analyticsByMode(query));
  },
);

insightsRouter.get(
  '/analytics/posts',
  requireAuth,
  validate({ query: analyticsPostsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof analyticsPostsQuerySchema>>(req);
    res.json(await analyticsPosts(query));
  },
);

/* ---------- Monday note ---------- */

insightsRouter.get(
  '/notes/latest',
  requireAuth,
  validate({ query: latestNoteQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof latestNoteQuerySchema>>(req);
    res.json(await latestNote(query.productId));
  },
);

insightsRouter.post(
  '/notes/generate',
  requireAuth,
  writer,
  validate({ body: generateNoteRequestSchema }),
  async (req, res) => {
    const { body } = parsed<z.output<typeof generateNoteRequestSchema>>(req);
    await assertProductWriter(req, body.productId, OWNER_ROLES);
    const weekStart = body.weekStart ?? thisWeekStart();
    const { row, created, before } = await generateMondayNote(body.productId, weekStart, {
      regenerate: body.regenerate,
    });
    if (created || before) {
      await writeAudit({
        ...auditContext(req),
        action: created ? 'note.write' : 'note.rewrite',
        entity: 'weekly_note',
        entityId: row.id,
        before: before ?? undefined,
        after: row,
      });
    }
    res.status(created ? 201 : 200).json(toWeeklyNote(row));
  },
);

/* ---------- Leads ---------- */

insightsRouter.get(
  '/leads',
  requireAuth,
  validate({ query: listLeadsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof listLeadsQuerySchema>>(req);
    res.json(await listLeads(query));
  },
);

insightsRouter.post(
  '/leads',
  requireAuth,
  writer,
  validate({ body: createLeadRequestSchema }),
  async (req, res) => {
    const { body } = parsed<z.output<typeof createLeadRequestSchema>>(req);
    res.status(201).json(await createLead(req, body));
  },
);

insightsRouter.get(
  '/leads/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    const { params } = parsed<unknown, unknown, IdParam>(req);
    res.json(await getLeadView(params.id));
  },
);

insightsRouter.patch(
  '/leads/:id',
  requireAuth,
  writer,
  validate({ params: idParamSchema, body: updateLeadRequestSchema }),
  async (req, res) => {
    const { params, body } = parsed<z.output<typeof updateLeadRequestSchema>, unknown, IdParam>(
      req,
    );
    res.json(await updateLead(req, params.id, body));
  },
);

insightsRouter.post(
  '/leads/:id/move',
  requireAuth,
  writer,
  validate({ params: idParamSchema, body: moveLeadRequestSchema }),
  async (req, res) => {
    const { params, body } = parsed<z.output<typeof moveLeadRequestSchema>, unknown, IdParam>(req);
    res.json(await moveLead(req, params.id, body));
  },
);

insightsRouter.get(
  '/leads/:id/activities',
  requireAuth,
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  async (req, res) => {
    const { params, query } = parsed<unknown, z.output<typeof paginationQuerySchema>, IdParam>(req);
    res.json(await listLeadActivities(params.id, query));
  },
);

insightsRouter.post(
  '/leads/:id/activities',
  requireAuth,
  writer,
  validate({ params: idParamSchema, body: createLeadActivityRequestSchema }),
  async (req, res) => {
    const { params, body } = parsed<
      z.output<typeof createLeadActivityRequestSchema>,
      unknown,
      IdParam
    >(req);
    res.status(201).json(await addLeadActivity(req, params.id, body));
  },
);

/* ---------- Keyword rules and events ---------- */

insightsRouter.get(
  '/keyword-rules',
  requireAuth,
  validate({ query: listKeywordRulesQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof listKeywordRulesQuerySchema>>(req);
    res.json(await listKeywordRules(query.productId));
  },
);

insightsRouter.post(
  '/keyword-rules',
  requireAuth,
  writer,
  validate({ body: createKeywordRuleRequestSchema }),
  async (req, res) => {
    const { body } = parsed<z.output<typeof createKeywordRuleRequestSchema>>(req);
    res.status(201).json(await createKeywordRule(req, body));
  },
);

insightsRouter.patch(
  '/keyword-rules/:id',
  requireAuth,
  writer,
  validate({ params: idParamSchema, body: updateKeywordRuleRequestSchema }),
  async (req, res) => {
    const { params, body } = parsed<
      z.output<typeof updateKeywordRuleRequestSchema>,
      unknown,
      IdParam
    >(req);
    res.json(await updateKeywordRule(req, params.id, body));
  },
);

insightsRouter.get(
  '/keyword-events',
  requireAuth,
  validate({ query: listKeywordEventsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof listKeywordEventsQuerySchema>>(req);
    res.json(await listKeywordEvents(query));
  },
);

/* ---------- Notifications (the signed-in user's own) ---------- */

insightsRouter.get(
  '/notifications',
  requireAuth,
  validate({ query: listNotificationsQuerySchema }),
  async (req, res) => {
    const { query } = parsed<unknown, z.output<typeof listNotificationsQuerySchema>>(req);
    res.json(await listNotifications(req.user!.id, query));
  },
);

// Before /:id/read so "read-all" is never taken as an id.
insightsRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  res.json(await markAllNotificationsRead(req));
});

insightsRouter.post(
  '/notifications/:id/read',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    const { params } = parsed<unknown, unknown, IdParam>(req);
    res.json(await markNotificationRead(req, params.id));
  },
);
