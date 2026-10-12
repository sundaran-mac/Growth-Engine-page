/**
 * TanStack Query hooks for the SETTINGS module. Every key starts with 'settings' and holds the
 * product id, so switching product in the sidebar fetches that product's data.
 * General tab and approvers use the PRODUCTS endpoints (PATCH /products/:id, PUT members).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateProductDocument,
  CreateProductDocumentResponse,
  ListResponse,
  NextSlotList,
  Platform,
  PostingSlot,
  PostingSlotInput,
  ProductChannelInput,
  ProductChannelView,
  ProductDetail,
  ProductDocument,
  ProductMembersResponse,
  ProductSettingsDetail,
  PutProductMembersRequest,
  ScheduleResponse,
  SyncRepoSpecsResponse,
  TeamListResponse,
  UpdateProductDocument,
  UpdateProductRequest,
  UpdateProductSettings,
  WeeklyRun,
} from '@growth-desk/contract';
import { api } from '@/lib/api';

export const settingsKeys = {
  all: ['settings'] as const,
  product: (id: string) => ['settings', id] as const,
  settings: (id: string) => ['settings', id, 'settings'] as const,
  slots: (id: string) => ['settings', id, 'slots'] as const,
  nextSlots: (id: string, platform: Platform | 'all', count: number) =>
    ['settings', id, 'slots', 'next', platform, count] as const,
  channels: (id: string) => ['settings', id, 'channels'] as const,
  documents: (id: string) => ['settings', id, 'documents'] as const,
  runs: (id: string) => ['settings', id, 'weekly-runs'] as const,
  productDetail: (id: string) => ['products', 'detail', id] as const,
  team: ['team', 'list'] as const,
  schedule: (id: string, from: string, to: string) =>
    ['settings', id, 'schedule', from, to] as const,
};

const silent = { silent: true } as const;

/* ---------- Settings ---------- */

export function useProductSettings(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.settings(productId ?? ''),
    queryFn: ({ signal }) =>
      api<ProductSettingsDetail>(`/products/${productId}/settings`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useUpdateSettings(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProductSettings) =>
      api<ProductSettingsDetail>(`/products/${productId}/settings`, { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.settings(productId), data);
      // Launch date and zone change the slot preview and the schedule.
      return qc.invalidateQueries({ queryKey: settingsKeys.product(productId) });
    },
    meta: silent,
  });
}

/* ---------- Slots ---------- */

export function useSlots(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.slots(productId ?? ''),
    queryFn: ({ signal }) =>
      api<ListResponse<PostingSlot>>(`/products/${productId}/slots`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useReplaceSlots(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slots: PostingSlotInput[]) =>
      api<ListResponse<PostingSlot>>(`/products/${productId}/slots`, {
        method: 'PUT',
        body: { slots },
      }),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.slots(productId), data);
      return qc.invalidateQueries({ queryKey: settingsKeys.product(productId) });
    },
    meta: silent,
  });
}

export function useNextSlots(productId: string | null, count = 10, platform?: Platform) {
  return useQuery({
    queryKey: settingsKeys.nextSlots(productId ?? '', platform ?? 'all', count),
    queryFn: ({ signal }) =>
      api<NextSlotList>(`/products/${productId}/slots/next`, {
        query: { count, platform },
        signal,
      }),
    enabled: Boolean(productId),
  });
}

/* ---------- Channels ---------- */

export function useProductChannels(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.channels(productId ?? ''),
    queryFn: ({ signal }) =>
      api<ListResponse<ProductChannelView>>(`/products/${productId}/channels`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useReplaceChannels(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (channels: ProductChannelInput[]) =>
      api<ListResponse<ProductChannelView>>(`/products/${productId}/channels`, {
        method: 'PUT',
        body: { channels },
      }),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.channels(productId), data);
      return qc.invalidateQueries({ queryKey: ['products'] });
    },
    meta: silent,
  });
}

/* ---------- Documents ---------- */

export function useDocuments(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.documents(productId ?? ''),
    queryFn: ({ signal }) =>
      api<ListResponse<ProductDocument>>(`/products/${productId}/documents`, {
        query: { limit: 100 },
        signal,
      }),
    enabled: Boolean(productId),
    // Poll while a document is being uploaded or processed.
    refetchInterval: (q) =>
      q.state.data?.items.some((d) => d.status === 'processing' || d.status === 'uploading')
        ? 3000
        : false,
  });
}

function useInvalidateDocuments(productId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: settingsKeys.documents(productId) });
}

export function useCreateDocument(productId: string) {
  const invalidate = useInvalidateDocuments(productId);
  return useMutation({
    mutationFn: (body: CreateProductDocument) =>
      api<CreateProductDocumentResponse>(`/products/${productId}/documents`, {
        method: 'POST',
        body,
      }),
    onSuccess: invalidate,
    meta: silent,
  });
}

export function useCompleteDocument(productId: string) {
  const invalidate = useInvalidateDocuments(productId);
  return useMutation({
    mutationFn: (id: string) =>
      api<ProductDocument>(`/documents/${id}/complete`, { method: 'POST' }),
    onSettled: invalidate,
    meta: silent,
  });
}

export function useUpdateDocument(productId: string) {
  const qc = useQueryClient();
  const key = settingsKeys.documents(productId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProductDocument }) =>
      api<ProductDocument>(`/documents/${id}`, { method: 'PATCH', body: patch }),
    // Optimistic pin / rename: safe to undo on error.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ListResponse<ProductDocument>>(key);
      if (previous) {
        qc.setQueryData<ListResponse<ProductDocument>>(key, {
          ...previous,
          items: previous.items.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    meta: silent,
  });
}

export function useDeleteDocument(productId: string) {
  const invalidate = useInvalidateDocuments(productId);
  return useMutation({
    mutationFn: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }),
    onSettled: invalidate,
    meta: silent,
  });
}

export function useReprocessDocument(productId: string) {
  const invalidate = useInvalidateDocuments(productId);
  return useMutation({
    mutationFn: (id: string) =>
      api<ProductDocument>(`/documents/${id}/reprocess`, { method: 'POST' }),
    onSettled: invalidate,
    meta: silent,
  });
}

export function useSyncRepo(productId: string) {
  const invalidate = useInvalidateDocuments(productId);
  return useMutation({
    mutationFn: () =>
      api<SyncRepoSpecsResponse>(`/products/${productId}/documents/sync-repo`, { method: 'POST' }),
    onSettled: invalidate,
    meta: silent,
  });
}

/** PUT the file straight to storage with progress (XHR, since fetch has no upload progress). */
export function uploadToStorage(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection.'));
    xhr.send(file);
  });
}

/* ---------- Weekly runs ---------- */

export function useWeeklyRuns(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.runs(productId ?? ''),
    queryFn: ({ signal }) =>
      api<ListResponse<WeeklyRun>>(`/products/${productId}/weekly-runs`, {
        query: { limit: 20 },
        signal,
      }),
    enabled: Boolean(productId),
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === 'queued' || r.status === 'running')
        ? 4000
        : false,
  });
}

export function useRunNow(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<WeeklyRun>(`/products/${productId}/weekly-runs`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: settingsKeys.runs(productId) }),
    meta: silent,
  });
}

/* ---------- Products module endpoints used here ---------- */

export function useProductDetail(productId: string | null) {
  return useQuery({
    queryKey: settingsKeys.productDetail(productId ?? ''),
    queryFn: ({ signal }) => api<ProductDetail>(`/products/${productId}`, { signal }),
    enabled: Boolean(productId),
  });
}

export function useTeamList() {
  return useQuery({
    queryKey: settingsKeys.team,
    queryFn: ({ signal }) => api<TeamListResponse>('/users', { query: { limit: 100 }, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useUpdateProductGeneral(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProductRequest) =>
      api<ProductDetail>(`/products/${productId}`, { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(settingsKeys.productDetail(productId), data);
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['products'] }),
        qc.invalidateQueries({ queryKey: settingsKeys.team }),
      ]);
    },
    meta: silent,
  });
}

export function usePutProductMembers(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PutProductMembersRequest) =>
      api<ProductMembersResponse>(`/products/${productId}/members`, { method: 'PUT', body }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: settingsKeys.productDetail(productId) }),
        qc.invalidateQueries({ queryKey: settingsKeys.team }),
      ]),
    meta: silent,
  });
}

/* ---------- Schedule ---------- */

export function useSchedule(productId: string | null, from: string, to: string) {
  return useQuery({
    queryKey: settingsKeys.schedule(productId ?? '', from, to),
    queryFn: ({ signal }) =>
      api<ScheduleResponse>('/schedule', { query: { productId, from, to }, signal }),
    enabled: Boolean(productId),
    // Keep the old range on screen while the next one loads, but never another product's data.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === productId ? prev : undefined),
  });
}
