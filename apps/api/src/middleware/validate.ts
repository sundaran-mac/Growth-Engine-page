/**
 * Request validation with zod. Parsed values replace the raw ones, so handlers get typed data.
 *
 *   router.post('/briefs', validate({ body: createBriefSchema }), handler)
 *   // in the handler: const body = req.body as z.infer<typeof createBriefSchema>
 *   // or use `parsed(req).query` for query and params (Express 5 makes req.query read-only).
 */
import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { validationError } from '../lib/errors.js';

export interface ValidateSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

const PARSED = Symbol('parsed');

interface Parsed {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, _res, next) => {
    const store: Parsed = ((req as unknown as Record<symbol, Parsed>)[PARSED] ??= {});
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? (part === 'body' ? {} : undefined));
      if (!result.success) return next(validationError(result.error, part));
      store[part] = result.data;
      // Express 5: `req.query` is a getter; body and params can be replaced.
      if (part === 'body') req.body = result.data;
      if (part === 'params') req.params = result.data as Request['params'];
    }
    next();
  };
}

/** Typed access to what `validate` parsed. */
export function parsed<B = unknown, Q = unknown, P = unknown>(
  req: Request,
): { body: B; query: Q; params: P } {
  const store = (req as unknown as Record<symbol, Parsed>)[PARSED] ?? {};
  return { body: store.body as B, query: store.query as Q, params: store.params as P };
}
