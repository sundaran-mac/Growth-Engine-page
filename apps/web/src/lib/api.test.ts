import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildUrl, isApiError, parseProblem } from './api';
import { jsonResponse } from '@/test/utils';

describe('buildUrl', () => {
  it('joins the base path and skips empty query values', () => {
    expect(buildUrl('/ideas', { limit: 10, status: ['new', 'starred'], q: '', x: undefined, y: null })).toBe(
      '/api/v1/ideas?limit=10&status=new&status=starred',
    );
    expect(buildUrl('products')).toBe('/api/v1/products');
  });
});

describe('parseProblem', () => {
  it('reads RFC 7807 problem+json', async () => {
    const res = jsonResponse(
      {
        type: 'https://growth-desk/errors/claim-check',
        title: 'Claim check failed',
        status: 422,
        detail: 'Remove "60-second call".',
        code: 'CLAIM_CHECK_FAILED',
        errors: [{ path: 'hook', message: 'Never-say word' }],
      },
      422,
      'application/problem+json',
    );
    const err = await parseProblem(res);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 422,
      code: 'CLAIM_CHECK_FAILED',
      title: 'Claim check failed',
      detail: 'Remove "60-second call".',
      errors: [{ path: 'hook', message: 'Never-say word' }],
    });
    expect(err.isClientError).toBe(true);
    expect(err.message).toBe('Remove "60-second call".');
  });

  it('joins array paths in field errors', async () => {
    const err = await parseProblem(
      jsonResponse({ title: 'Bad', status: 400, code: 'VALIDATION_FAILED', errors: [{ path: ['beats', 0, 'text'], message: 'Required' }] }, 400),
    );
    expect(err.errors).toEqual([{ path: 'beats.0.text', message: 'Required' }]);
  });

  it('falls back when the body is not JSON', async () => {
    const err = await parseProblem(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(err).toMatchObject({ status: 502, code: 'HTTP_502', title: 'Server not reachable', errors: [] });
    expect(err.isServerError).toBe(true);
  });
});

describe('api()', () => {
  it('sends JSON with credentials and returns the body', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(api('/briefs', { method: 'POST', body: { title: 'x' } })).resolves.toEqual({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/briefs');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"x"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws ApiError for 401 problem responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ title: 'Sign in', status: 401, code: 'UNAUTHENTICATED' }, 401, 'application/problem+json')),
    );
    const err = await api('/auth/me').catch((e: unknown) => e);
    expect(isApiError(err)).toBe(true);
    expect((err as ApiError).isUnauthorized).toBe(true);
    expect((err as ApiError).code).toBe('UNAUTHENTICATED');
  });

  it('maps network failure to status 0 NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const err = (await api('/products').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.isServerError).toBe(true);
  });
});

describe('parseProblem extensions', () => {
  it('keeps extra problem members such as matches', async () => {
    const { parseProblem } = await import('./api');
    const res = new Response(
      JSON.stringify({ status: 409, code: 'IDEA_DUPLICATE', title: 'Duplicate', matches: [{ id: 'a' }], requestId: 'r1' }),
      { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    );
    const err = await parseProblem(res);
    expect(err.extensions).toEqual({ matches: [{ id: 'a' }] });
  });
});
