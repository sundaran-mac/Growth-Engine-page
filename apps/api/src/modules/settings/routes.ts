/**
 * SETTINGS routes (mounted at /api/v1):
 *   GET/PATCH /products/:productId/settings
 *   GET/PUT   /products/:productId/slots, GET /products/:productId/slots/next
 *   GET/PUT   /products/:productId/channels
 *   GET/POST  /products/:productId/documents, POST /products/:productId/documents/sync-repo
 *   POST /documents/:id/complete, PATCH/DELETE /documents/:id, POST /documents/:id/reprocess
 *   GET/POST  /products/:productId/weekly-runs
 *   GET /schedule?productId&from&to
 * Read: admin, editor or anyone on the product. Edit: product owner or admin.
 */
import { Router, type RequestHandler } from 'express';
import {
  createProductDocumentSchema,
  idParamSchema,
  nextSlotsQuerySchema,
  PLATFORMS,
  productDocumentListQuerySchema,
  replacePostingSlotsSchema,
  replaceProductChannelsSchema,
  scheduleQuerySchema,
  settingsProductParamSchema,
  updateProductDocumentSchema,
  updateProductSettingsSchema,
  weeklyRunListQuerySchema,
  type CreateProductDocument,
  type NextSlotsQuery,
  type PaginationQuery,
  type ReplacePostingSlots,
  type ReplaceProductChannels,
  type ScheduleQuery,
  type UpdateProductDocument,
  type UpdateProductSettings,
} from '@growth-desk/contract';
import { auditContext } from '../../lib/audit.js';
import { requireAuth } from '../../middleware/auth.js';
import { parsed, validate } from '../../middleware/validate.js';
import {
  canEditProduct,
  productFromLocals,
  productFromParams,
  requireProductEdit,
  requireProductRead,
} from './access.js';
import {
  completeDocumentUpload,
  createDocument,
  deleteDocument,
  getDocumentRow,
  listDocuments,
  reprocessDocument,
  syncRepoSpecs,
  updateDocument,
} from './documents.js';
import {
  computeNextFreeSlots,
  ensureSettingsRow,
  getProductOr404,
  getSchedule,
  getSettingsDetail,
  listProductChannels,
  listSlots,
  replaceProductChannels,
  replaceSlots,
  toNextSlotDto,
  updateSettings,
} from './service.js';
import { listRuns, startManualRun } from './weekly.js';

export const settingsRouter: Router = Router();

const productParams = validate({ params: settingsProductParamSchema });
const read = requireProductRead(productFromParams);
const edit = requireProductEdit(productFromParams);

/** 404 for an unknown product (products are listed to every signed-in user). */
const productExists: RequestHandler = async (req, _res, next) => {
  try {
    await getProductOr404(String(req.params.productId));
    next();
  } catch (err) {
    next(err);
  }
};

/** Loads the document, puts its product id on res.locals for the role check. */
const loadDocument: RequestHandler = async (req, res, next) => {
  try {
    const row = await getDocumentRow(String(req.params.id));
    res.locals.productId = row.productId;
    next();
  } catch (err) {
    next(err);
  }
};
const docParams = validate({ params: idParamSchema });
const docEdit = requireProductEdit(productFromLocals);

/* ---------- Settings ---------- */

settingsRouter.get(
  '/products/:productId/settings',
  requireAuth,
  productParams,
  productExists,
  read,
  async (req, res) => {
    const productId = String(req.params.productId);
    res.json(await getSettingsDetail(productId, await canEditProduct(req, productId)));
  },
);

settingsRouter.patch(
  '/products/:productId/settings',
  requireAuth,
  productParams,
  productExists,
  edit,
  validate({ body: updateProductSettingsSchema }),
  async (req, res) => {
    const productId = String(req.params.productId);
    await updateSettings(productId, parsed<UpdateProductSettings>(req).body, auditContext(req));
    res.json(await getSettingsDetail(productId, true));
  },
);

/* ---------- Posting slots ---------- */

settingsRouter.get(
  '/products/:productId/slots',
  requireAuth,
  productParams,
  productExists,
  read,
  async (req, res) => {
    const items = await listSlots(String(req.params.productId));
    res.json({ items, total: items.length });
  },
);

settingsRouter.put(
  '/products/:productId/slots',
  requireAuth,
  productParams,
  productExists,
  edit,
  validate({ body: replacePostingSlotsSchema }),
  async (req, res) => {
    const items = await replaceSlots(
      String(req.params.productId),
      parsed<ReplacePostingSlots>(req).body.slots,
      auditContext(req),
    );
    res.json({ items, total: items.length });
  },
);

settingsRouter.get(
  '/products/:productId/slots/next',
  requireAuth,
  productParams,
  productExists,
  read,
  validate({ query: nextSlotsQuerySchema }),
  async (req, res) => {
    const productId = String(req.params.productId);
    const q = parsed<unknown, NextSlotsQuery>(req).query;
    const from = q.from ? new Date(q.from) : new Date();
    const settings = await ensureSettingsRow(productId);
    const found = await computeNextFreeSlots(
      productId,
      q.platform ? [q.platform] : PLATFORMS,
      from,
      q.count,
    );
    res.json({ items: found.map(toNextSlotDto), launchDate: settings.launchDate });
  },
);

/* ---------- Product channels ---------- */

settingsRouter.get(
  '/products/:productId/channels',
  requireAuth,
  productParams,
  productExists,
  read,
  async (req, res) => {
    const items = await listProductChannels(String(req.params.productId));
    res.json({ items, total: items.length });
  },
);

settingsRouter.put(
  '/products/:productId/channels',
  requireAuth,
  productParams,
  productExists,
  edit,
  validate({ body: replaceProductChannelsSchema }),
  async (req, res) => {
    const items = await replaceProductChannels(
      String(req.params.productId),
      parsed<ReplaceProductChannels>(req).body.channels,
      auditContext(req),
    );
    res.json({ items, total: items.length });
  },
);

/* ---------- Knowledge documents ---------- */

settingsRouter.get(
  '/products/:productId/documents',
  requireAuth,
  productParams,
  productExists,
  read,
  validate({ query: productDocumentListQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, PaginationQuery>(req).query;
    res.json(await listDocuments(String(req.params.productId), q.limit, q.offset));
  },
);

settingsRouter.post(
  '/products/:productId/documents',
  requireAuth,
  productParams,
  productExists,
  edit,
  validate({ body: createProductDocumentSchema }),
  async (req, res) => {
    const out = await createDocument(
      String(req.params.productId),
      parsed<CreateProductDocument>(req).body,
      auditContext(req),
    );
    res.status(201).json(out);
  },
);

settingsRouter.post(
  '/products/:productId/documents/sync-repo',
  requireAuth,
  productParams,
  productExists,
  edit,
  async (req, res) => {
    res.json(await syncRepoSpecs(String(req.params.productId), auditContext(req)));
  },
);

settingsRouter.post(
  '/documents/:id/complete',
  requireAuth,
  docParams,
  loadDocument,
  docEdit,
  async (req, res) => {
    res.json(await completeDocumentUpload(String(req.params.id), auditContext(req)));
  },
);

settingsRouter.patch(
  '/documents/:id',
  requireAuth,
  docParams,
  loadDocument,
  docEdit,
  validate({ body: updateProductDocumentSchema }),
  async (req, res) => {
    res.json(
      await updateDocument(
        String(req.params.id),
        parsed<UpdateProductDocument>(req).body,
        auditContext(req),
      ),
    );
  },
);

settingsRouter.delete(
  '/documents/:id',
  requireAuth,
  docParams,
  loadDocument,
  docEdit,
  async (req, res) => {
    await deleteDocument(String(req.params.id), auditContext(req));
    res.status(204).end();
  },
);

settingsRouter.post(
  '/documents/:id/reprocess',
  requireAuth,
  docParams,
  loadDocument,
  docEdit,
  async (req, res) => {
    res.json(await reprocessDocument(String(req.params.id), auditContext(req)));
  },
);

/* ---------- Weekly runs ---------- */

settingsRouter.get(
  '/products/:productId/weekly-runs',
  requireAuth,
  productParams,
  productExists,
  read,
  validate({ query: weeklyRunListQuerySchema }),
  async (req, res) => {
    const q = parsed<unknown, PaginationQuery>(req).query;
    res.json(await listRuns(String(req.params.productId), q.limit, q.offset));
  },
);

settingsRouter.post(
  '/products/:productId/weekly-runs',
  requireAuth,
  productParams,
  productExists,
  edit,
  async (req, res) => {
    res.status(202).json(await startManualRun(String(req.params.productId), auditContext(req)));
  },
);

/* ---------- Schedule view ---------- */

settingsRouter.get(
  '/schedule',
  requireAuth,
  validate({ query: scheduleQuerySchema }),
  (req, res, next) => {
    res.locals.productId = parsed<unknown, ScheduleQuery>(req).query.productId;
    next();
  },
  async (req, _res, next) => {
    try {
      await getProductOr404(parsed<unknown, ScheduleQuery>(req).query.productId);
      next();
    } catch (err) {
      next(err);
    }
  },
  requireProductRead(productFromLocals),
  async (req, res) => {
    const q = parsed<unknown, ScheduleQuery>(req).query;
    res.json(await getSchedule(q.productId, new Date(q.from), new Date(q.to)));
  },
);
