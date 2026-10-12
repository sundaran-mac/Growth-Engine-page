/**
 * TanStack Query hooks for the products module: products, kit, members, team, integrations.
 * Every key starts with 'products', 'team' or 'integrations', so one invalidate refreshes the
 * product switcher too (its key is ['products', 'list', ...]).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProductRequest,
  CreateUserRequest,
  CreateUserResponse,
  IntegrationsStatusResponse,
  KitRefreshResult,
  ProductDetail,
  ProductKitView,
  ProductListResponse,
  ProductMembersResponse,
  PutProductMembersRequest,
  TeamListResponse,
  TeamMember,
  UpdateKitRequest,
  UpdateProductRequest,
  UpdateUserRequest,
} from '@growth-desk/contract';
import { api } from '@/lib/api';

export const productKeys = {
  all: ['products'] as const,
  list: () => ['products', 'list', { scope: 'page' }] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  kit: (id: string) => ['products', 'kit', id] as const,
  team: ['team', 'list'] as const,
  integrations: ['integrations', 'status'] as const,
};

/* ---------- Products ---------- */

export function useProducts() {
  return useQuery({
    queryKey: productKeys.list(),
    queryFn: ({ signal }) =>
      api<ProductListResponse>('/products', { query: { limit: 100 }, signal }),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: ({ signal }) => api<ProductDetail>(`/products/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductRequest) =>
      api<ProductDetail>('/products', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.all }),
    meta: { silent: true },
  });
}

export function useUpdateProduct(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProductRequest) =>
      api<ProductDetail>(`/products/${id}`, { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(productKeys.detail(id), data);
      return Promise.all([
        qc.invalidateQueries({ queryKey: productKeys.all }),
        qc.invalidateQueries({ queryKey: productKeys.team }),
      ]);
    },
    meta: { silent: true },
  });
}

export function usePutMembers(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutProductMembersRequest) =>
      api<ProductMembersResponse>(`/products/${id}/members`, { method: 'PUT', body }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: productKeys.detail(id) }),
        qc.invalidateQueries({ queryKey: productKeys.team }),
      ]),
    meta: { silent: true },
  });
}

/* ---------- Kit ---------- */

export function useKit(productId: string | undefined) {
  return useQuery({
    queryKey: productKeys.kit(productId ?? ''),
    queryFn: ({ signal }) => api<ProductKitView>(`/products/${productId}/kit`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useUpdateKit(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateKitRequest) =>
      api<ProductKitView>(`/products/${productId}/kit`, { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(productKeys.kit(productId), data);
      return qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    meta: { silent: true },
  });
}

export function useSignKit(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<ProductKitView>(`/products/${productId}/kit/sign`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.setQueryData(productKeys.kit(productId), data);
      return qc.invalidateQueries({ queryKey: ['products', 'list'] });
    },
    meta: { silent: true },
  });
}

export function useRefreshKit(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<KitRefreshResult>(`/products/${productId}/kit/refresh`, { method: 'POST' }),
    onSuccess: (result) => {
      qc.setQueryData<ProductKitView>(productKeys.kit(productId), (old) =>
        old ? { ...old, lastRefresh: result } : old,
      );
    },
    meta: { silent: true },
  });
}

/* ---------- Integrations ---------- */

export function useIntegrationsStatus() {
  return useQuery({
    queryKey: productKeys.integrations,
    queryFn: ({ signal }) => api<IntegrationsStatusResponse>('/integrations/status', { signal }),
  });
}

/* ---------- Team ---------- */

export function useTeam() {
  return useQuery({
    queryKey: productKeys.team,
    queryFn: ({ signal }) => api<TeamListResponse>('/users', { query: { limit: 100 }, signal }),
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) =>
      api<CreateUserResponse>('/users', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.team }),
    meta: { silent: true },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) =>
      api<TeamMember>(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: productKeys.team }),
    meta: { silent: true },
  });
}
