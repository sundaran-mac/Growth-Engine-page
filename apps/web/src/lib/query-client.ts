import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/session';
import { isApiError } from './api';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { silent?: boolean };
    mutationMeta: { silent?: boolean };
  }
}

/**
 * Global error policy:
 * - 401: clear the session; the route guard sends the user to /login.
 * - 5xx and network errors: one toast (skip with meta.silent).
 * - Other 4xx: the screen handles it (form errors, empty states).
 */
export function handleGlobalError(error: unknown, silent = false): void {
  if (!isApiError(error)) return;
  if (error.isUnauthorized) {
    useSessionStore.getState().clearSession();
    return;
  }
  if (error.isServerError && !silent) {
    toast.error(error.title, {
      id: `api-${error.status}-${error.code}`,
      description: error.detail ?? 'Please try again in a moment.',
    });
  }
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.isClientError) return false;
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => handleGlobalError(error, query.meta?.silent),
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => handleGlobalError(error, mutation.meta?.silent),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
