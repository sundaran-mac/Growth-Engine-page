/**
 * publish module routes (mounted at /api/v1):
 *   GET    /channel-accounts                         list (no tokens), any signed-in user
 *   DELETE /channel-accounts/:id                     disconnect (admin, editor)
 *   GET    /integrations/oauth/:platform/start       -> {url} (admin, editor)
 *   GET    /integrations/oauth/:platform/callback    provider redirect -> 302 to the web
 *   GET    /publish/queue?productId                  briefs approved, scheduled or live
 *   GET    /publish/briefs/:briefId                  brief, gate, best window, settings
 *   GET    /briefs/:briefId/posts                    rows of the Publish screen
 *   POST   /briefs/:briefId/posts/schedule-all
 *   PATCH  /posts/:id
 *   POST   /posts/:id/post-now | /retry | /cancel | /mark-posted
 *   GET    /posts/:id/tracked-link | /media-url
 *
 * Reads need a membership on the product (admin passes). Changes need admin, or a membership
 * plus global role editor, or product role owner or backup.
 */
import { Router, type RequestHandler } from 'express';
import {
  channelAccountsQuerySchema,
  idParamSchema,
  markPostedSchema,
  oauthCallbackQuerySchema,
  oauthPlatformParamsSchema,
  oauthStartQuerySchema,
  publishBriefParamsSchema,
  publishQueueQuerySchema,
  updatePostSchema,
  type ChannelAccountsQuery,
  type MarkPostedRequest,
  type OAuthCallbackQuery,
  type OAuthPlatform,
  type OAuthStartQuery,
  type PublishQueueQuery,
  type UpdatePostRequest,
} from '@growth-desk/contract';
import { auditContext } from '../../lib/audit.js';
import { forbidden, notFound, unauthenticated } from '../../lib/errors.js';
import {
  fromQuery,
  loadUser,
  type ProductIdFrom,
  requireAuth,
  requireProductRole,
  requireRole,
} from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { getMemberships } from '../auth/service.js';
import { listChannelAccounts, productIdOfBrief, productIdOfPost } from './repo.js';
import {
  cancelPost,
  disconnectChannelAccount,
  getPostMediaUrl,
  getPublishSummary,
  getTrackedLinkForPost,
  handleOAuthCallback,
  listBriefPosts,
  listPublishQueue,
  markPosted,
  postNow,
  retryPost,
  scheduleAll,
  startOAuth,
  updatePost,
} from './service.js';

export const publishRouter: Router = Router();

/* ---------- Access helpers ---------- */

/** Product id of a brief or post in the URL; 404 when the record does not exist. */
const productOfBrief: ProductIdFrom = async (req) => {
  const id = req.params.briefId;
  const productId = typeof id === 'string' ? await productIdOfBrief(id) : undefined;
  if (!productId) throw notFound('Brief');
  return productId;
};

const productOfPost: ProductIdFrom = async (req) => {
  const id = req.params.id;
  const productId = typeof id === 'string' ? await productIdOfPost(id) : undefined;
  if (!productId) throw notFound('Post');
  return productId;
};

/** Read access: any membership on the product (admin passes). */
const canRead = (from: ProductIdFrom): RequestHandler => requireProductRole(from);

/** Change access: admin; or a member who is a global editor, or the product owner or backup. */
function canPublish(from: ProductIdFrom): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(unauthenticated());
      const productId = await from(req);
      if (req.user.role === 'admin') return next();
      const memberships = req.memberships ?? (await getMemberships(req.user.id));
      const mine = memberships.filter((m) => m.productId === productId);
      const ok =
        mine.length > 0 &&
        (req.user.role === 'editor' || mine.some((m) => m.productRole === 'owner' || m.productRole === 'backup'));
      if (ok) return next();
      next(forbidden('Only an editor, or the product owner or backup, can publish.'));
    } catch (err) {
      next(err);
    }
  };
}

/* ---------- Channel accounts ---------- */

publishRouter.get(
  '/channel-accounts',
  requireAuth,
  validate({ query: channelAccountsQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, ChannelAccountsQuery>(req).query;
    res.json(await listChannelAccounts(q));
  },
);

publishRouter.delete(
  '/channel-accounts/:id',
  requireAuth,
  requireRole('editor'),
  validate({ params: idParamSchema }),
  async (req, res) => {
    const { id } = parsed<unknown, unknown, { id: string }>(req).params;
    await disconnectChannelAccount(id, auditContext(req));
    res.status(204).end();
  },
);

/* ---------- OAuth connect ---------- */

/** When a product is named, connecting for it needs a membership on it (admin passes). */
const memberOfQueryProduct: RequestHandler = (req, res, next) => {
  if (typeof req.query.productId !== 'string') return next();
  return requireProductRole(fromQuery('productId'))(req, res, next);
};

publishRouter.get(
  '/integrations/oauth/:platform/start',
  requireAuth,
  requireRole('editor'),
  validate({ params: oauthPlatformParamsSchema, query: oauthStartQuerySchema }),
  memberOfQueryProduct,
  (req, res) => {
    const { platform } = parsed<unknown, unknown, { platform: OAuthPlatform }>(req).params;
    const { productId } = parsed<unknown, OAuthStartQuery>(req).query;
    res.set('Cache-Control', 'no-store').json(startOAuth(platform, req.user!.id, productId ?? null));
  },
);

/** The provider sends the browser here. No session needed: the signed state names the user. */
publishRouter.get(
  '/integrations/oauth/:platform/callback',
  loadUser,
  validate({ params: oauthPlatformParamsSchema, query: oauthCallbackQuerySchema }),
  async (req, res) => {
    const { platform } = parsed<unknown, unknown, { platform: OAuthPlatform }>(req).params;
    const query = parsed<unknown, OAuthCallbackQuery>(req).query;
    const { requestId, ip } = auditContext(req);
    const target = await handleOAuthCallback(platform, query, req.user?.id ?? null, { requestId, ip });
    res.set('Cache-Control', 'no-store').redirect(302, target);
  },
);

/* ---------- Publish queue and summary ---------- */

publishRouter.get(
  '/publish/queue',
  requireAuth,
  validate({ query: publishQueueQuerySchema }),
  canRead(fromQuery('productId')),
  async (req, res) => {
    res.json(await listPublishQueue(parsed<unknown, PublishQueueQuery>(req).query));
  },
);

publishRouter.get(
  '/publish/briefs/:briefId',
  requireAuth,
  validate({ params: publishBriefParamsSchema }),
  canRead(productOfBrief),
  async (req, res) => {
    res.json(await getPublishSummary(parsed<unknown, unknown, { briefId: string }>(req).params.briefId));
  },
);

publishRouter.get(
  '/briefs/:briefId/posts',
  requireAuth,
  validate({ params: publishBriefParamsSchema }),
  canRead(productOfBrief),
  async (req, res) => {
    res.json(await listBriefPosts(parsed<unknown, unknown, { briefId: string }>(req).params.briefId));
  },
);

publishRouter.post(
  '/briefs/:briefId/posts/schedule-all',
  requireAuth,
  validate({ params: publishBriefParamsSchema }),
  canPublish(productOfBrief),
  async (req, res) => {
    const { briefId } = parsed<unknown, unknown, { briefId: string }>(req).params;
    res.json(await scheduleAll(briefId, auditContext(req)));
  },
);

/* ---------- Posts ---------- */

const postParams = validate({ params: idParamSchema });
const postId = (req: Parameters<RequestHandler>[0]) => parsed<unknown, unknown, { id: string }>(req).params.id;

publishRouter.patch(
  '/posts/:id',
  requireAuth,
  validate({ params: idParamSchema, body: updatePostSchema }),
  canPublish(productOfPost),
  async (req, res) => {
    res.json(await updatePost(postId(req), parsed<UpdatePostRequest>(req).body, auditContext(req)));
  },
);

publishRouter.post('/posts/:id/post-now', requireAuth, postParams, canPublish(productOfPost), async (req, res) => {
  res.json(await postNow(postId(req), auditContext(req)));
});

publishRouter.post('/posts/:id/retry', requireAuth, postParams, canPublish(productOfPost), async (req, res) => {
  res.json(await retryPost(postId(req), auditContext(req)));
});

publishRouter.post('/posts/:id/cancel', requireAuth, postParams, canPublish(productOfPost), async (req, res) => {
  res.json(await cancelPost(postId(req), auditContext(req)));
});

publishRouter.post(
  '/posts/:id/mark-posted',
  requireAuth,
  validate({ params: idParamSchema, body: markPostedSchema }),
  canPublish(productOfPost),
  async (req, res) => {
    res.json(await markPosted(postId(req), parsed<MarkPostedRequest>(req).body, auditContext(req)));
  },
);

publishRouter.get('/posts/:id/tracked-link', requireAuth, postParams, canRead(productOfPost), async (req, res) => {
  res.json(await getTrackedLinkForPost(postId(req)));
});

publishRouter.get('/posts/:id/media-url', requireAuth, postParams, canRead(productOfPost), async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await getPostMediaUrl(postId(req)));
});

