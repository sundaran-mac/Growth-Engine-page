/**
 * Access rules of the SETTINGS module:
 * - read: admin or editor (global), or any role on the product;
 * - edit: the product owner, or an admin.
 */
import type { Request, RequestHandler } from 'express';
import { forbidden, unauthenticated } from '../../lib/errors.js';
import { getMemberships } from '../auth/service.js';

export type ProductIdSource = (req: Request) => string | undefined;

export const productFromParams: ProductIdSource = (req) => {
  const v = req.params.productId;
  return typeof v === 'string' ? v : undefined;
};

/** Product id that `loadDocument` put on `res.locals`. */
export const productFromLocals: ProductIdSource = (req) => {
  const v: unknown = req.res?.locals.productId;
  return typeof v === 'string' ? v : undefined;
};

async function roleOn(req: Request, productId: string) {
  const memberships = req.memberships ?? (await getMemberships(req.user!.id));
  return memberships.filter((m) => m.productId === productId).map((m) => m.productRole);
}

export async function canReadProduct(req: Request, productId: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'editor') return true;
  return (await roleOn(req, productId)).length > 0;
}

export async function canEditProduct(req: Request, productId: string): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === 'admin') return true;
  return (await roleOn(req, productId)).includes('owner');
}

function guard(check: (req: Request, productId: string) => Promise<boolean>, message: string) {
  return (from: ProductIdSource): RequestHandler =>
    async (req, _res, next) => {
      try {
        if (!req.user) return next(unauthenticated());
        const productId = from(req);
        if (!productId) return next(forbidden(message));
        if (await check(req, productId)) return next();
        next(forbidden(message));
      } catch (err) {
        next(err);
      }
    };
}

export const requireProductRead = guard(canReadProduct, 'You are not on the team of this product.');
export const requireProductEdit = guard(
  canEditProduct,
  'Only the product owner or an admin can change these settings.',
);
