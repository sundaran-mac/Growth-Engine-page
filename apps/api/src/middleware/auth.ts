/**
 * Auth and access guards.
 *
 *   router.get('/x', requireAuth, handler)
 *   router.post('/x', requireAuth, requireRole('admin', 'editor'), handler)
 *   router.post('/products/:productId/kit/sign', requireAuth,
 *     requireProductRole(fromParams('productId'), 'owner', 'backup'), handler)
 *
 * Admins pass every role and product-role check.
 */
import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import { SESSION_COOKIE_NAME, type ProductRole, type Role } from '@growth-desk/contract';
import { env } from '../config/env.js';
import { badRequest, forbidden, unauthenticated } from '../lib/errors.js';
import { getMemberships, loadSession, sessionTtlMs } from '../modules/auth/service.js';

export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
    maxAge: sessionTtlMs(),
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...opts } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE_NAME, opts);
}

export function readSessionToken(req: Request): string | null {
  const value: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Loads the session when there is one. Never rejects. */
export const loadUser: RequestHandler = async (req, res, next) => {
  try {
    const token = readSessionToken(req);
    if (token) {
      const session = await loadSession(token);
      if (session) {
        req.user = session.user;
        req.sessionId = session.sessionId;
        req.memberships = await getMemberships(session.user.id);
        if (session.refreshed) setSessionCookie(res, token);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

/** 401 unless signed in. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  if (req.user) return next();
  await loadUser(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user) return next(unauthenticated());
    next();
  });
};

/** 403 unless the global role is one of `roles` (admin always passes). Use after requireAuth. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthenticated());
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    next(forbidden());
  };
}

/** 403 unless the user is a brand approver (Elan) or an admin. */
export const requireBrandApprover: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthenticated());
  if (req.user.isBrandApprover || req.user.role === 'admin') return next();
  next(forbidden('Only the brand approver can do this.', 'GATE_NOT_ALLOWED'));
};

export type ProductIdFrom = (req: Request) => string | undefined | Promise<string | undefined>;

export const fromParams =
  (name: string): ProductIdFrom =>
  (req) => {
    const v = req.params[name];
    return typeof v === 'string' ? v : undefined;
  };
export const fromBody =
  (name: string): ProductIdFrom =>
  (req) => {
    const v: unknown = (req.body as Record<string, unknown> | undefined)?.[name];
    return typeof v === 'string' ? v : undefined;
  };
export const fromQuery =
  (name: string): ProductIdFrom =>
  (req) => {
    const v = req.query[name];
    return typeof v === 'string' ? v : undefined;
  };

/**
 * 403 unless the user has one of `roles` on the product (any role when none given).
 * `productIdFrom` may be async, for example to look up the product of a brief.
 */
export function requireProductRole(
  productIdFrom: ProductIdFrom,
  ...roles: ProductRole[]
): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(unauthenticated());
      const productId = await productIdFrom(req);
      if (!productId) return next(badRequest('Product id is missing.'));
      if (req.user.role === 'admin') return next();
      const memberships = req.memberships ?? (await getMemberships(req.user.id));
      const ok = memberships.some(
        (m) => m.productId === productId && (roles.length === 0 || roles.includes(m.productRole)),
      );
      if (ok) return next();
      next(forbidden('You do not have this role on the product.'));
    } catch (err) {
      next(err);
    }
  };
}
