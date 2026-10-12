import { env } from './env';

/** One field error inside an RFC 7807 problem (for forms). */
export interface ApiFieldError {
  path: string;
  message: string;
}

/**
 * Error thrown by `api()` for every non-2xx response and for network failure (status 0).
 * Parsed from RFC 7807 application/problem+json when the server sends it.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly errors: ApiFieldError[];
  /** Extra problem members (RFC 7807 extensions), for example `matches` on IDEA_DUPLICATE. */
  readonly extensions: Record<string, unknown>;

  constructor(init: {
    status: number;
    code: string;
    title: string;
    detail?: string | undefined;
    type?: string | undefined;
    errors?: ApiFieldError[];
    extensions?: Record<string, unknown>;
  }) {
    super(init.detail ?? init.title);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.type = init.type;
    this.errors = init.errors ?? [];
    this.extensions = init.extensions ?? {};
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
  get isServerError(): boolean {
    return this.status >= 500 || this.status === 0;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

type QueryValue = string | number | boolean | null | undefined;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body. Objects are serialised; FormData and Blob are sent as is. */
  body?: unknown;
  query?: Record<string, QueryValue | QueryValue[]>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const STATUS_TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Please sign in',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  422: 'Check the form',
  429: 'Too many requests',
  500: 'Something went wrong',
  502: 'Server not reachable',
  503: 'Service not available',
};

export function buildUrl(path: string, query?: ApiOptions['query']): string {
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  if (query) {
    for (const [key, raw] of Object.entries(query)) {
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (value === undefined || value === null || value === '') continue;
        params.append(key, String(value));
      }
    }
  }
  const qs = params.toString();
  return `${base}${cleanPath}${qs ? `?${qs}` : ''}`;
}

function toFieldErrors(raw: unknown): ApiFieldError[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ApiFieldError[] => {
    if (!item || typeof item !== 'object') return [];
    const rec = item as Record<string, unknown>;
    const path = Array.isArray(rec.path) ? rec.path.join('.') : String(rec.path ?? rec.field ?? '');
    const message = String(rec.message ?? '');
    return message ? [{ path, message }] : [];
  });
}

/** Turn any failed Response into an ApiError. Exported for tests. */
export async function parseProblem(res: Response): Promise<ApiError> {
  const fallbackTitle = STATUS_TITLES[res.status] ?? (res.statusText || 'Request failed');
  let payload: Record<string, unknown> | null = null;
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return new ApiError({
    status: res.status,
    code: str(payload?.code) ?? `HTTP_${res.status}`,
    title: str(payload?.title) ?? fallbackTitle,
    detail: str(payload?.detail),
    type: str(payload?.type),
    errors: toFieldErrors(payload?.errors),
    extensions: payload ? problemExtensions(payload) : {},
  });
}

const PROBLEM_MEMBERS = new Set(['type', 'title', 'status', 'detail', 'instance', 'code', 'errors', 'requestId']);

/** Everything in a problem body that is not a standard member. */
export function problemExtensions(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !PROBLEM_MEMBERS.has(k)));
}

/**
 * Fetch wrapper for the Growth Desk API. Sends cookies, speaks JSON, throws ApiError.
 * Returns `undefined` for 204 responses.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, query, headers = {}, signal } = options;
  const isRawBody = body instanceof FormData || body instanceof Blob;
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json, application/problem+json',
      ...(body !== undefined && !isRawBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    signal: signal ?? null,
  };
  if (body !== undefined) {
    init.body = isRawBody ? (body as BodyInit) : JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      title: 'Cannot reach the server',
      detail: 'Check your connection and try again.',
    });
  }

  if (!res.ok) throw await parseProblem(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Short helpers for the common verbs. */
export const http = {
  get: <T>(path: string, query?: ApiOptions['query'], signal?: AbortSignal) =>
    api<T>(path, { query, ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
};
