/**
 * products module routes (PRODUCTS agent). Mounted at /api/v1.
 *
 *   GET    /products                      any signed-in user (also the product switcher)
 *   POST   /products                      admin, editor
 *   GET    /products/:id                  any signed-in user
 *   PATCH  /products/:id                  admin, product owner
 *   PUT    /products/:id/members          admin, product owner
 *   GET    /products/:id/kit              any signed-in user
 *   PUT    /products/:id/kit              admin, editor, product owner or backup
 *   POST   /products/:id/kit/sign         product owner only
 *   POST   /products/:id/kit/refresh      admin, editor, product owner or backup
 *   GET    /integrations/status           any signed-in user
 *   GET    /users                         any signed-in user
 *   POST   /users                         admin
 *   PATCH  /users/:id                     admin
 */
import { Router, type RequestHandler } from 'express';
import {
  createProductRequestSchema,
  createUserRequestSchema,
  idParamSchema,
  productListQuerySchema,
  putProductMembersRequestSchema,
  teamListQuerySchema,
  updateKitRequestSchema,
  updateProductRequestSchema,
  updateUserRequestSchema,
  type CreateProductRequest,
  type CreateUserRequest,
  type IdParam,
  type ProductListQuery,
  type PutProductMembersRequest,
  type TeamListQuery,
  type UpdateKitRequest,
  type UpdateProductRequest,
  type UpdateUserRequest,
} from '@growth-desk/contract';
import { auditContext } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import { fromParams, requireAuth, requireProductRole, requireRole } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import { integrationsStatus } from './integrations.js';
import { refreshKit } from './kit-refresh.js';
import {
  canEditKit,
  createProduct,
  getKitView,
  getProductDetail,
  listProducts,
  putMembers,
  signKit,
  updateKit,
  updateProduct,
} from './service.js';
import { createUser, listTeam, updateUser } from './team.js';

export const productsRouter: Router = Router();

const idParams = validate({ params: idParamSchema });
const paramId = (req: Parameters<RequestHandler>[0]) =>
  parsed<unknown, unknown, IdParam>(req).params.id;

/** Admin, editor, or owner/backup of the product in `:id`. */
const requireKitEditor: RequestHandler = async (req, _res, next) => {
  try {
    if (await canEditKit(req.user!, paramId(req))) return next();
    next(forbidden('Only an editor, or the product owner or backup, can change the kit.'));
  } catch (err) {
    next(err);
  }
};

/* ---------- Products ---------- */

productsRouter.get(
  '/products',
  requireAuth,
  validate({ query: productListQuerySchema }),
  async (req, res) => {
    res.json(await listProducts(parsed<unknown, ProductListQuery>(req).query));
  },
);

productsRouter.post(
  '/products',
  requireAuth,
  requireRole('editor'),
  validate({ body: createProductRequestSchema }),
  async (req, res) => {
    const body = parsed<CreateProductRequest>(req).body;
    res.status(201).json(await createProduct(body, req.user!, auditContext(req)));
  },
);

productsRouter.get('/products/:id', requireAuth, idParams, async (req, res) => {
  res.json(await getProductDetail(paramId(req)));
});

productsRouter.patch(
  '/products/:id',
  requireAuth,
  idParams,
  requireProductRole(fromParams('id'), 'owner'),
  validate({ body: updateProductRequestSchema }),
  async (req, res) => {
    const body = parsed<UpdateProductRequest>(req).body;
    res.json(await updateProduct(paramId(req), body, auditContext(req)));
  },
);

productsRouter.put(
  '/products/:id/members',
  requireAuth,
  idParams,
  requireProductRole(fromParams('id'), 'owner'),
  validate({ body: putProductMembersRequestSchema }),
  async (req, res) => {
    const body = parsed<PutProductMembersRequest>(req).body;
    const items = await putMembers(paramId(req), body, auditContext(req));
    res.json({ items, total: items.length });
  },
);

/* ---------- Kit ---------- */

productsRouter.get('/products/:id/kit', requireAuth, idParams, async (req, res) => {
  res.json(await getKitView(paramId(req), req.user!));
});

productsRouter.put(
  '/products/:id/kit',
  requireAuth,
  idParams,
  requireKitEditor,
  validate({ body: updateKitRequestSchema }),
  async (req, res) => {
    const body = parsed<UpdateKitRequest>(req).body;
    res.json(await updateKit(paramId(req), body, req.user!, auditContext(req)));
  },
);

productsRouter.post('/products/:id/kit/sign', requireAuth, idParams, async (req, res) => {
  res.json(await signKit(paramId(req), req.user!, auditContext(req)));
});

productsRouter.post(
  '/products/:id/kit/refresh',
  requireAuth,
  idParams,
  requireKitEditor,
  async (req, res) => {
    res.json(await refreshKit(paramId(req), auditContext(req)));
  },
);

/* ---------- Integrations ---------- */

productsRouter.get('/integrations/status', requireAuth, async (_req, res) => {
  res.json(await integrationsStatus());
});

/* ---------- Team ---------- */

productsRouter.get(
  '/users',
  requireAuth,
  validate({ query: teamListQuerySchema }),
  async (req, res) => {
    res.json(await listTeam(parsed<unknown, TeamListQuery>(req).query));
  },
);

productsRouter.post(
  '/users',
  requireAuth,
  requireRole('admin'),
  validate({ body: createUserRequestSchema }),
  async (req, res) => {
    const body = parsed<CreateUserRequest>(req).body;
    res.status(201).json(await createUser(body, auditContext(req)));
  },
);

productsRouter.patch(
  '/users/:id',
  requireAuth,
  requireRole('admin'),
  idParams,
  validate({ body: updateUserRequestSchema }),
  async (req, res) => {
    const body = parsed<UpdateUserRequest>(req).body;
    res.json(await updateUser(paramId(req), body, req.user!, auditContext(req)));
  },
);
