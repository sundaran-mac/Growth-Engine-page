/**
 * Errors as RFC 7807 problem details (`application/problem+json`).
 * Throw `AppError` (or a helper below) anywhere; `errorHandler` turns it into the response.
 */
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import {
  PROBLEM_CONTENT_TYPE,
  type FieldError,
  type KnownErrorCode,
  type ProblemDetails,
} from '@growth-desk/contract';
import { logger } from './logger.js';

export interface AppErrorOptions {
  status: number;
  code: KnownErrorCode | (string & {});
  title: string;
  detail?: string;
  errors?: FieldError[];
  /** Extra problem members (RFC 7807 extensions), for example `matches` on IDEA_DUPLICATE. */
  extensions?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly extensions: Record<string, unknown> | undefined;

  constructor(opts: AppErrorOptions) {
    super(opts.detail ?? opts.title, { cause: opts.cause });
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.title = opts.title;
    this.detail = opts.detail;
    this.errors = opts.errors;
    this.extensions = opts.extensions;
  }
}

export const badRequest = (detail: string, code = 'VALIDATION_FAILED', errors?: FieldError[]) =>
  new AppError({ status: 400, code, title: 'Bad request', detail, ...(errors ? { errors } : {}) });
export const unauthenticated = (detail = 'Sign in to continue.') =>
  new AppError({ status: 401, code: 'UNAUTHENTICATED', title: 'Not signed in', detail });
export const forbidden = (detail = 'You do not have access to this.', code = 'FORBIDDEN') =>
  new AppError({ status: 403, code, title: 'Forbidden', detail });
export const notFound = (what = 'Resource') =>
  new AppError({
    status: 404,
    code: 'NOT_FOUND',
    title: 'Not found',
    detail: `${what} not found.`,
  });
export const conflict = (detail: string, code = 'CONFLICT') =>
  new AppError({ status: 409, code, title: 'Conflict', detail });
export const unprocessable = (detail: string, code: string) =>
  new AppError({ status: 422, code, title: 'Cannot do this now', detail });
export const featureDisabled = (feature: string, detail?: string) =>
  new AppError({
    status: 503,
    code: 'FEATURE_DISABLED',
    title: `${feature} is not set up`,
    detail: detail ?? `${feature} is turned off because its keys are not set.`,
  });

/** Map zod issues to `{ path, message }`. */
export function zodToFieldErrors(error: z.ZodError, prefix?: string): FieldError[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    message: issue.message,
  }));
}

export function validationError(error: z.ZodError, prefix?: string): AppError {
  return new AppError({
    status: 400,
    code: 'VALIDATION_FAILED',
    title: 'Validation failed',
    detail: 'Some fields are not valid.',
    errors: zodToFieldErrors(error, prefix),
  });
}

const TYPE_BASE = 'https://growth-desk.humini.app/problems/';

export function toProblem(err: AppError, instance?: string, requestId?: string): ProblemDetails {
  return {
    ...(err.extensions ?? {}),
    type: `${TYPE_BASE}${err.code.toLowerCase().replace(/_/g, '-')}`,
    title: err.title,
    status: err.status,
    code: err.code,
    ...(err.detail ? { detail: err.detail } : {}),
    ...(instance ? { instance } : {}),
    ...(requestId ? { requestId } : {}),
    ...(err.errors ? { errors: err.errors } : {}),
  };
}

/** Postgres error codes we turn into clean 4xx answers. */
function fromPgError(err: unknown): AppError | null {
  const code = (err as { code?: unknown })?.code;
  const cause = (err as { cause?: { code?: unknown } })?.cause;
  const pgCode =
    typeof code === 'string' ? code : typeof cause?.code === 'string' ? cause.code : null;
  switch (pgCode) {
    case '23505':
      return conflict('This already exists.');
    case '23503':
      return badRequest('A linked record does not exist.', 'VALIDATION_FAILED');
    case '22P02':
      return badRequest('A value has the wrong format.', 'VALIDATION_FAILED');
    case '23514':
      return badRequest('A value is out of the allowed range.', 'VALIDATION_FAILED');
    default:
      return null;
  }
}

export function normaliseError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) return validationError(err);
  // body-parser errors carry `type` and `status`.
  const e = err as { type?: string; status?: number; expose?: boolean; message?: string };
  if (e?.type === 'entity.parse.failed') return badRequest('The request body is not valid JSON.');
  if (e?.type === 'entity.too.large') {
    return new AppError({ status: 413, code: 'PAYLOAD_TOO_LARGE', title: 'Payload too large' });
  }
  const pg = fromPgError(err);
  if (pg) return pg;
  return new AppError({
    status: 500,
    code: 'INTERNAL_ERROR',
    title: 'Something went wrong',
    detail: 'An unexpected error happened. It has been logged.',
    cause: err,
  });
}

export function sendProblem(
  res: Parameters<RequestHandler>[1],
  err: AppError,
  instance?: string,
  requestId?: string,
): void {
  res
    .status(err.status)
    .type(PROBLEM_CONTENT_TYPE)
    .json(toProblem(err, instance, requestId));
}

/** Final Express error handler. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const appErr = normaliseError(err);
  const log = req.log ?? logger;
  if (appErr.status >= 500) log.error({ err }, 'request failed');
  else log.debug({ code: appErr.code, status: appErr.status }, 'request rejected');
  sendProblem(res, appErr, req.originalUrl, req.id ? String(req.id) : undefined);
};

/** 404 for unknown routes. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    new AppError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not found',
      detail: `No route for ${req.method} ${req.path}.`,
    }),
  );
};
