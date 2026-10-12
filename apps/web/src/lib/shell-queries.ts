/**
 * Queries the app shell needs (product switcher, notification bell, approvals badge).
 * Module agents own the full feature hooks in src/features/<module>; these are read-only
 * and kept small on purpose.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  ListResponse,
  Notification,
  Product,
  ReadAllNotificationsResponse,
} from '@growth-desk/contract';

export const shellKeys = {
  products: ['products', 'list', { scope: 'switcher' }] as const,
  notifications: ['notifications', 'list'] as const,
  approvalsWaiting: ['approvals', 'waiting-count'] as const,
};

export function useProductsForSwitcher() {
  return useQuery({
    queryKey: shellKeys.products,
    queryFn: ({ signal }) =>
      api<ListResponse<Product>>('/products', { query: { limit: 100 }, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: shellKeys.notifications,
    queryFn: ({ signal }) =>
      api<ListResponse<Notification>>('/notifications', { query: { limit: 20 }, signal }),
    enabled,
    staleTime: 60_000,
    meta: { silent: true },
  });
}

/** Count of approvals waiting on the signed-in user. Hidden in the UI if the call fails. */
export function useApprovalsWaitingCount() {
  return useQuery({
    queryKey: shellKeys.approvalsWaiting,
    queryFn: ({ signal }) =>
      api<ListResponse<unknown>>('/approvals', {
        query: { decision: 'pending', mine: true, limit: 1 },
        signal,
      }),
    select: (data) => data.total,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Notification>(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shellKeys.notifications }),
    meta: { silent: true },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<ReadAllNotificationsResponse>('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: shellKeys.notifications }),
  });
}
