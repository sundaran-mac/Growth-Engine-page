import type { LoginRequest, MeResponse } from '@growth-desk/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '@/stores/session';
import { api, isApiError } from './api';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

/**
 * Current user (GET /auth/me). Resolves to null when not signed in (401), so it never
 * throws for that case. Keeps useSessionStore in step.
 */
export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: async ({ signal }) => {
      try {
        const me = await api<MeResponse>('/auth/me', { signal });
        useSessionStore.getState().setSession(me);
        return me;
      } catch (error) {
        if (isApiError(error) && error.isUnauthorized) {
          useSessionStore.getState().clearSession();
          return null;
        }
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** POST /auth/login. The response body is the same as GET /auth/me. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginRequest) => api<MeResponse>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (me) => {
      useSessionStore.getState().setSession(me);
      qc.setQueryData(authKeys.me, me);
    },
    // The login form shows its own errors; no global toast.
    meta: { silent: true },
  });
}

/** POST /auth/logout. Clears the session and every cached query, even if the call fails. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      useSessionStore.getState().clearSession();
      qc.clear();
      qc.setQueryData(authKeys.me, null);
    },
    meta: { silent: true },
  });
}
