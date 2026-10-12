/**
 * MAKE server state: briefs, claim check, Claude co-writer, assets, render jobs, hand-off tools.
 * Every hook talks to the API in `apps/api/src/modules/make`. Shapes come from the contract.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssetListResponse,
  AssetUrlResponse,
  AssistKind,
  AssistResponse,
  Brief,
  BriefListResponse,
  BriefOptions,
  BriefStage,
  ClaimCheckRequest,
  ClaimCheckResult,
  CompleteUploadInput,
  CreateBriefInput,
  CreateRenderJobInput,
  CreateUploadInput,
  CreateUploadResponse,
  FeatureFlags,
  HandoffToolList,
  HealthResponse,
  MakeAsset,
  RenderJob,
  RenderJobListResponse,
  UpdateAssetInput,
  UpdateBriefInput,
  UpdateRenderJobInput,
} from '@growth-desk/contract';
import { api } from '@/lib/api';

export const makeKeys = {
  all: ['make'] as const,
  briefs: () => [...makeKeys.all, 'briefs'] as const,
  briefList: (params: BriefListParams) => [...makeKeys.briefs(), 'list', params] as const,
  brief: (id: string) => [...makeKeys.briefs(), 'detail', id] as const,
  briefOptions: (id: string) => [...makeKeys.briefs(), 'options', id] as const,
  assets: (briefId: string) => [...makeKeys.all, 'assets', briefId] as const,
  assetUrl: (assetId: string) => [...makeKeys.all, 'asset-url', assetId] as const,
  renderJobs: (briefId: string) => [...makeKeys.all, 'render-jobs', briefId] as const,
  handoffTools: () => [...makeKeys.all, 'handoff-tools'] as const,
  features: () => [...makeKeys.all, 'features'] as const,
};

/* ---------- Feature flags (Claude, storage) ---------- */

/** Which third-party features are switched on. Read from GET /health. */
export function useMakeFeatures() {
  return useQuery({
    queryKey: makeKeys.features(),
    queryFn: ({ signal }) => api<HealthResponse>('/health', { signal }),
    select: (d): FeatureFlags => d.features,
    staleTime: 5 * 60_000,
    meta: { silent: true },
  });
}

/* ---------- Briefs ---------- */

export interface BriefListParams {
  productId: string | null;
  stage?: BriefStage[];
  q?: string;
  limit?: number;
  offset?: number;
}

export function useBriefs(params: BriefListParams) {
  return useQuery({
    queryKey: makeKeys.briefList(params),
    enabled: Boolean(params.productId),
    queryFn: ({ signal }) =>
      api<BriefListResponse>('/briefs', {
        signal,
        query: {
          productId: params.productId,
          stage: params.stage && params.stage.length > 0 ? params.stage.join(',') : undefined,
          q: params.q || undefined,
          limit: params.limit ?? 50,
          offset: params.offset ?? 0,
        },
      }),
    placeholderData: (prev) => prev,
  });
}

export function useBrief(briefId: string | undefined) {
  return useQuery({
    queryKey: makeKeys.brief(briefId ?? 'none'),
    enabled: Boolean(briefId),
    queryFn: ({ signal }) => api<Brief>(`/briefs/${briefId}`, { signal }),
  });
}

export function useBriefOptions(briefId: string | undefined) {
  return useQuery({
    queryKey: makeKeys.briefOptions(briefId ?? 'none'),
    enabled: Boolean(briefId),
    queryFn: ({ signal }) => api<BriefOptions>(`/briefs/${briefId}/options`, { signal }),
    staleTime: 5 * 60_000,
  });
}

/** Puts a fresh brief in the cache and marks lists stale. */
function useStoreBrief() {
  const qc = useQueryClient();
  return (brief: Brief) => {
    qc.setQueryData(makeKeys.brief(brief.id), brief);
    void qc.invalidateQueries({ queryKey: [...makeKeys.briefs(), 'list'] });
  };
}

export function useCreateBrief() {
  const store = useStoreBrief();
  return useMutation({
    mutationFn: (input: CreateBriefInput) => api<Brief>('/briefs', { method: 'POST', body: input }),
    onSuccess: store,
  });
}

/** Autosave. 409 VERSION_CONFLICT means someone else saved first: reload before editing again. */
export function useUpdateBrief(briefId: string) {
  const store = useStoreBrief();
  return useMutation({
    mutationFn: (input: UpdateBriefInput) =>
      api<Brief>(`/briefs/${briefId}`, { method: 'PATCH', body: input }),
    onSuccess: store,
    meta: { silent: true },
  });
}

function useBriefAction(briefId: string, action: 'freeze' | 'unfreeze' | 'send-for-review') {
  const store = useStoreBrief();
  return useMutation({
    mutationFn: (version: number) =>
      api<Brief>(`/briefs/${briefId}/${action}`, { method: 'POST', body: { version } }),
    onSuccess: store,
  });
}

export const useFreezeBrief = (briefId: string) => useBriefAction(briefId, 'freeze');
export const useUnfreezeBrief = (briefId: string) => useBriefAction(briefId, 'unfreeze');
export const useSendForReview = (briefId: string) => useBriefAction(briefId, 'send-for-review');

/* ---------- Claim check and co-writer ---------- */

export function useClaimCheck(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClaimCheckRequest) =>
      api<ClaimCheckResult>(`/briefs/${briefId}/claim-check`, { method: 'POST', body: input }),
    onSuccess: (result) => {
      if (result.stored) void qc.invalidateQueries({ queryKey: makeKeys.brief(briefId) });
    },
    meta: { silent: true },
  });
}

export function useAssist(briefId: string) {
  return useMutation({
    mutationFn: (kind: AssistKind) =>
      api<AssistResponse>(`/briefs/${briefId}/assist`, { method: 'POST', body: { kind } }),
  });
}

/* ---------- Assets ---------- */

export function useBriefAssets(briefId: string | undefined) {
  return useQuery({
    queryKey: makeKeys.assets(briefId ?? 'none'),
    enabled: Boolean(briefId),
    queryFn: ({ signal }) => api<AssetListResponse>(`/briefs/${briefId}/assets`, { signal }),
  });
}

/** Presigned GET for a ready asset. URLs live 15 minutes; refetch a little before. */
export function useAssetUrl(assetId: string | null | undefined) {
  return useQuery({
    queryKey: makeKeys.assetUrl(assetId ?? 'none'),
    enabled: Boolean(assetId),
    queryFn: ({ signal }) => api<AssetUrlResponse>(`/assets/${assetId}/url`, { signal }),
    staleTime: 10 * 60_000,
    refetchInterval: 12 * 60_000,
  });
}

export const createUpload = (input: CreateUploadInput) =>
  api<CreateUploadResponse>('/assets/uploads', { method: 'POST', body: input });
export const completeUpload = (assetId: string, input: CompleteUploadInput) =>
  api<MakeAsset>(`/assets/${assetId}/complete`, { method: 'POST', body: input });
export const abortUpload = (assetId: string) =>
  api<undefined>(`/assets/${assetId}/abort`, { method: 'POST', body: {} });

/** Manual loudness (LUFS), licence, consent and AI label of a file. */
export function useUpdateAsset(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAssetInput & { id: string }) =>
      api<MakeAsset>(`/assets/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: makeKeys.assets(briefId) }),
  });
}

export function useDeleteAsset(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assetId: string) => api<undefined>(`/assets/${assetId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: makeKeys.assets(briefId) }),
  });
}

/* ---------- Render jobs ---------- */

export function useRenderJobs(briefId: string | undefined) {
  return useQuery({
    queryKey: makeKeys.renderJobs(briefId ?? 'none'),
    enabled: Boolean(briefId),
    queryFn: ({ signal }) =>
      api<RenderJobListResponse>(`/briefs/${briefId}/render-jobs`, { signal }),
    refetchInterval: (q) =>
      q.state.data?.items.some((j) => j.status === 'running' || j.status === 'queued')
        ? 15_000
        : false,
  });
}

export function useCreateRenderJob(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRenderJobInput) =>
      api<RenderJob>(`/briefs/${briefId}/render-jobs`, { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: makeKeys.renderJobs(briefId) }),
  });
}

export function useUpdateRenderJob(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateRenderJobInput & { id: string }) =>
      api<RenderJob>(`/render-jobs/${id}`, { method: 'PATCH', body: input }),
    onMutate: async ({ id, ...input }) => {
      const key = makeKeys.renderJobs(briefId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<RenderJobListResponse>(key);
      if (prev) {
        qc.setQueryData<RenderJobListResponse>(key, {
          ...prev,
          items: prev.items.map((j) =>
            j.id === id
              ? {
                  ...j,
                  ...(input.status ? { status: input.status } : {}),
                  ...(input.progress !== undefined ? { progress: input.progress } : {}),
                  ...(input.label ? { label: input.label } : {}),
                }
              : j,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(makeKeys.renderJobs(briefId), ctx.prev);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: makeKeys.renderJobs(briefId) }),
  });
}

/* ---------- Hand-off tools ---------- */

export function useHandoffTools() {
  return useQuery({
    queryKey: makeKeys.handoffTools(),
    queryFn: ({ signal }) => api<HandoffToolList>('/handoff-tools', { signal }),
    staleTime: 30 * 60_000,
  });
}
