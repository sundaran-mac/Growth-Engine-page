/**
 * Small HTTP client for platform calls: timeouts, zod-validated responses and errors mapped
 * to stable connector codes. Tokens are never logged.
 */
import type { z } from 'zod';
import { logger } from '../lib/logger.js';
import { ConnectorError } from './types.js';

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Big uploads (YouTube, LinkedIn parts) get more time. */
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;

type QueryValue = string | number | boolean | undefined | null;

export interface HttpRequest<S extends z.ZodType | undefined = undefined> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  /** Sent as application/x-www-form-urlencoded. */
  form?: Record<string, string>;
  /** Raw bytes or a stream (uploads). */
  body?: RequestInit['body'];
  timeoutMs?: number;
  /** Validates the JSON response. Omit for calls whose body we ignore. */
  schema?: S;
  /** Platform name for messages, for example `Instagram`. */
  label: string;
}

export interface HttpResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

export function buildRequestUrl(url: string, query?: Record<string, QueryValue>): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/** Pulls a readable message out of the usual platform error bodies. */
export function platformMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return typeof body === 'string' && body ? body.slice(0, 300) : null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error_user_msg === 'string') return e.error_user_msg;
  }
  if (typeof err === 'string') {
    return typeof b.error_description === 'string' ? `${err}: ${b.error_description}` : err;
  }
  if (typeof b.message === 'string') return b.message;
  return null;
}

/** Maps an HTTP failure to a connector error code. */
export function codeForStatus(status: number): ConnectorError['code'] {
  if (status === 401) return 'PLATFORM_AUTH_FAILED';
  if (status === 429) return 'PLATFORM_RATE_LIMITED';
  return 'PLATFORM_ERROR';
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function httpRequest<S extends z.ZodType | undefined = undefined>(
  req: HttpRequest<S>,
): Promise<HttpResponse<S extends z.ZodType ? z.infer<S> : unknown>> {
  const method = req.method ?? (req.json !== undefined || req.form || req.body ? 'POST' : 'GET');
  const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
  let body: RequestInit['body'] | undefined;
  if (req.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.json);
  } else if (req.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(req.form).toString();
  } else if (req.body !== undefined) {
    body = req.body;
  }
  const url = buildRequestUrl(req.url, req.query);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = body;
    // Streams need half duplex in Node fetch.
    if (body instanceof ReadableStream) init.duplex = 'half';
    res = await fetch(url, init);
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ConnectorError('PLATFORM_TIMEOUT', `${req.label} did not answer within ${Math.round(timeoutMs / 1000)} s.`, { cause: err });
    }
    throw new ConnectorError('PLATFORM_ERROR', `${req.label} could not be reached.`, { cause: err });
  }

  const data = await readBody(res);
  if (!res.ok) {
    const msg = platformMessage(data) ?? `HTTP ${res.status}`;
    logger.warn({ platform: req.label, status: res.status, host: new URL(url).host }, 'platform call failed');
    throw new ConnectorError(codeForStatus(res.status), `${req.label}: ${msg}`, { httpStatus: res.status });
  }
  if (!req.schema) {
    return { status: res.status, headers: res.headers, data: data as S extends z.ZodType ? z.infer<S> : unknown };
  }
  const parsedBody = req.schema.safeParse(data);
  if (!parsedBody.success) {
    throw new ConnectorError('PLATFORM_ERROR', `${req.label} sent an answer we do not understand.`, {
      httpStatus: res.status,
      cause: parsedBody.error,
    });
  }
  return { status: res.status, headers: res.headers, data: parsedBody.data as S extends z.ZodType ? z.infer<S> : unknown };
}

/** Wait helper that tests can replace (polling Instagram and LinkedIn processing). */
export const runtime = {
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),
  pollIntervalMs: 5_000,
  pollAttempts: 60,
};
