/**
 * CSRF guard for cookie auth: every mutating request must come from an allowed origin.
 * Uses `Origin`, or `Referer` when a browser leaves `Origin` out. Requests with neither are refused.
 */
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function createOriginCheck(
  allowed: readonly string[],
  exemptPaths: readonly string[] = [],
): RequestHandler {
  const allow = new Set(allowed);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    // Match on the full path: under app.use(prefix, ...) `req.path` has the prefix removed.
    const fullPath = req.originalUrl.split('?')[0] ?? '';
    if (exemptPaths.some((p) => fullPath.startsWith(p))) return next();
    const origin = originOf(req.get('origin')) ?? originOf(req.get('referer'));
    if (origin && allow.has(origin)) return next();
    next(
      new AppError({
        status: 403,
        code: 'ORIGIN_NOT_ALLOWED',
        title: 'Origin not allowed',
        detail: 'This request did not come from the Growth Desk web app.',
      }),
    );
  };
}

/**
 * Webhooks are called by platforms (no browser origin) and verify their own signatures,
 * so `/api/v1/webhooks/*` is exempt.
 */
export const originCheck = createOriginCheck(env.webOrigins, ['/api/v1/webhooks/']);
