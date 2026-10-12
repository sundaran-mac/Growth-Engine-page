import { QueryClient } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type * as React from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { vi } from 'vitest';
import { AppProviders } from '@/app/providers';
import { shouldRetry } from '@/lib/query-client';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } },
  });
}
export { shouldRetry };

/** Response helper for mocked fetch. */
export function jsonResponse(body: unknown, status = 200, contentType = 'application/json') {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

export type FetchRoutes = Record<string, (init?: RequestInit) => Response | Promise<Response>>;

/**
 * Mock global fetch by "METHOD /path" (path without the /api/v1 base and query string).
 * Unknown routes return 404 problem+json.
 */
export function mockFetch(routes: FetchRoutes) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString(), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`;
    const handler = routes[key];
    if (handler) return handler(init);
    return jsonResponse({ type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' }, 404, 'application/problem+json');
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export function renderWithRouter(routes: RouteObject[], initialEntries: string[] = ['/'], options?: RenderOptions) {
  const router = createMemoryRouter(routes, { initialEntries });
  const client = createTestQueryClient();
  const utils = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
    options,
  );
  return { ...utils, router, client };
}

export function renderWithProviders(ui: React.ReactElement, initialEntries: string[] = ['/']) {
  return renderWithRouter([{ path: '*', element: ui }], initialEntries);
}

export const ME = {
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Jeeva Santiago',
    email: 'jeeva@arus.sg',
    initials: 'JS',
    title: 'Marketing · Design',
    role: 'editor' as const,
    isBrandApprover: false,
  },
  memberships: [],
};
