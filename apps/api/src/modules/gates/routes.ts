/**
 * Gates module routes (Review and Approvals), mounted at /api/v1.
 *
 *   GET   /review/queue                   pieces in review or waiting for approval
 *   GET   /briefs/:id/review              checklist, master asset, current approvals
 *   PATCH /briefs/:id/review/checklist    manual ticks
 *   GET   /briefs/:id/comments            comments for a version
 *   POST  /briefs/:id/comments            comment at a timecode
 *   PATCH /comments/:id                   resolve, reopen, edit (author)
 *   POST  /briefs/:id/send-for-approval   creates the claims and brand gates
 *   POST  /briefs/:id/send-back           back to the brief with a note (version + 1)
 *   GET   /approvals                      queue (mine by default)
 *   GET   /approvals/:id                  detail with claims and decision log
 *   POST  /approvals/:id/decide           approve or request changes
 *
 * Every route needs a session. Product access and gate rules live in service.ts / access.ts.
 */
import { Router, type Request } from 'express';
import {
  approvalsQuerySchema,
  createReviewCommentRequestSchema,
  decideApprovalRequestSchema,
  idParamSchema,
  reviewCommentsQuerySchema,
  reviewQueueQuerySchema,
  sendBackRequestSchema,
  sendForApprovalRequestSchema,
  updateChecklistRequestSchema,
  updateReviewCommentRequestSchema,
  type ApprovalsQuery,
  type CreateReviewCommentRequest,
  type DecideApprovalRequest,
  type IdParam,
  type ReviewCommentsQuery,
  type ReviewQueueQuery,
  type SendBackRequest,
  type SendForApprovalRequest,
  type UpdateChecklistRequest,
  type UpdateReviewCommentRequest,
} from '@growth-desk/contract';
import { auditContext } from '../../lib/audit.js';
import { requireAuth } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { actorFrom } from './access.js';
import * as service from './service.js';

export const gatesRouter: Router = Router();

const idOf = (req: Request) => parsed<unknown, unknown, IdParam>(req).params.id;

/* ---------- Review ---------- */

gatesRouter.get(
  '/review/queue',
  requireAuth,
  validate({ query: reviewQueueQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, ReviewQueueQuery>(req).query;
    res.json(await service.reviewQueue(actorFrom(req), q));
  },
);

gatesRouter.get(
  '/briefs/:id/review',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    res.json(await service.getReview(actorFrom(req), idOf(req)));
  },
);

gatesRouter.patch(
  '/briefs/:id/review/checklist',
  requireAuth,
  validate({ params: idParamSchema, body: updateChecklistRequestSchema }),
  async (req, res) => {
    const body = parsed<UpdateChecklistRequest>(req).body;
    res.json(await service.updateChecklist(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);

gatesRouter.get(
  '/briefs/:id/comments',
  requireAuth,
  validate({ params: idParamSchema, query: reviewCommentsQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, ReviewCommentsQuery>(req).query;
    res.json(await service.listComments(actorFrom(req), idOf(req), q));
  },
);

gatesRouter.post(
  '/briefs/:id/comments',
  requireAuth,
  validate({ params: idParamSchema, body: createReviewCommentRequestSchema }),
  async (req, res) => {
    const body = parsed<CreateReviewCommentRequest>(req).body;
    res
      .status(201)
      .json(await service.createComment(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);

gatesRouter.patch(
  '/comments/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updateReviewCommentRequestSchema }),
  async (req, res) => {
    const body = parsed<UpdateReviewCommentRequest>(req).body;
    res.json(await service.updateComment(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);

gatesRouter.post(
  '/briefs/:id/send-for-approval',
  requireAuth,
  validate({ params: idParamSchema, body: sendForApprovalRequestSchema }),
  async (req, res) => {
    const body = parsed<SendForApprovalRequest>(req).body;
    res
      .status(201)
      .json(await service.sendForApproval(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);

gatesRouter.post(
  '/briefs/:id/send-back',
  requireAuth,
  validate({ params: idParamSchema, body: sendBackRequestSchema }),
  async (req, res) => {
    const body = parsed<SendBackRequest>(req).body;
    res.json(await service.sendBack(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);

/* ---------- Approvals ---------- */

gatesRouter.get(
  '/approvals',
  requireAuth,
  validate({ query: approvalsQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, ApprovalsQuery>(req).query;
    res.json(await service.listApprovals(actorFrom(req), q));
  },
);

gatesRouter.get(
  '/approvals/:id',
  requireAuth,
  validate({ params: idParamSchema }),
  async (req, res) => {
    res.json(await service.getApproval(actorFrom(req), idOf(req)));
  },
);

gatesRouter.post(
  '/approvals/:id/decide',
  requireAuth,
  validate({ params: idParamSchema, body: decideApprovalRequestSchema }),
  async (req, res) => {
    const body = parsed<DecideApprovalRequest>(req).body;
    res.json(await service.decideApproval(actorFrom(req), idOf(req), body, auditContext(req)));
  },
);
