/**
 * Server state for the Ideas board, the Plan and occasions (TanStack Query).
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  Idea,
  IdeaBoardInfo,
  IdeaCreateInput,
  IdeaGenerateInput,
  IdeaGenerateResponse,
  IdeaOpenBriefResponse,
  IdeaStatus,
  ListResponse,
  Occasion,
  OccasionCreateInput,
  PlanChecks,
  PlanFreezeResponse,
  PlanGetResponse,
  PlanItemCreateInput,
  PlanItemUpdateInput,
  PlanItemView,
  PlanView,
} from '@growth-desk/contract';
import { api } from '@/lib/api';

export const ideasKeys = {
  all: ['ideas'] as const,
  list: (productId: string) => ['ideas', 'list', productId] as const,
  board: (productId: string) => ['ideas', 'board', productId] as const,
};

export const planKeys = {
  all: ['plans'] as const,
  month: (productId: string, month: string) => ['plans', 'month', productId, month] as const,
  checks: (planId: string) => ['plans', 'checks', planId] as const,
};

export const occasionKeys = {
  all: ['occasions'] as const,
  range: (from: string, to: string, productId: string | null) => ['occasions', from, to, productId] as const,
};

/* ---------- Ideas ---------- */

export function useIdeas(productId: string | null) {
  return useQuery({
    queryKey: ideasKeys.list(productId ?? 'none'),
    queryFn: ({ signal }) => api<ListResponse<Idea>>('/ideas', { query: { productId, limit: 100 }, signal }),
    enabled: Boolean(productId),
  });
}

export function useStarredIdeas(productId: string | null) {
  return useQuery({
    queryKey: [...ideasKeys.list(productId ?? 'none'), 'starred'] as const,
    queryFn: ({ signal }) =>
      api<ListResponse<Idea>>('/ideas', { query: { productId, status: 'starred', limit: 100 }, signal }),
    enabled: Boolean(productId),
  });
}

export function useIdeaBoard(productId: string | null) {
  return useQuery({
    queryKey: ideasKeys.board(productId ?? 'none'),
    queryFn: ({ signal }) => api<IdeaBoardInfo>('/ideas/board', { query: { productId }, signal }),
    enabled: Boolean(productId),
    meta: { silent: true },
  });
}

function invalidateIdeas(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: ideasKeys.all });
}

export function useCreateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IdeaCreateInput) => api<Idea>('/ideas', { method: 'POST', body: input }),
    onSuccess: () => invalidateIdeas(qc),
  });
}

export function useGenerateIdeas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: IdeaGenerateInput) => api<IdeaGenerateResponse>('/ideas/generate', { method: 'POST', body: input }),
    onSuccess: () => invalidateIdeas(qc),
    // The panel shows its own message (Claude not connected, budget used up).
    meta: { silent: true },
  });
}

/** Optimistically moves an idea to its new column, rolls back on error. */
function useIdeaStatusMutation<V extends { idea: Idea }>(
  call: (vars: V) => Promise<Idea>,
  nextStatus: (vars: V) => IdeaStatus,
  nextNote?: (vars: V) => string | null,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: call,
    onMutate: async (vars) => {
      const key = ideasKeys.list(vars.idea.productId);
      await qc.cancelQueries({ queryKey: key, exact: true });
      const previous = qc.getQueryData<ListResponse<Idea>>(key);
      if (previous) {
        qc.setQueryData<ListResponse<Idea>>(key, {
          ...previous,
          items: previous.items.map((i) =>
            i.id === vars.idea.id
              ? { ...i, status: nextStatus(vars), ...(nextNote ? { note: nextNote(vars) } : {}) }
              : i,
          ),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(ctx.key, ctx.previous);
    },
    onSettled: () => invalidateIdeas(qc),
  });
}

export function useStarIdea() {
  return useIdeaStatusMutation<{ idea: Idea; starred: boolean }>(
    ({ idea, starred }) => api<Idea>(`/ideas/${idea.id}/star`, { method: 'POST', body: { starred } }),
    ({ starred }) => (starred ? 'starred' : 'new'),
  );
}

export function useParkIdea() {
  return useIdeaStatusMutation<{ idea: Idea; reason: string }>(
    ({ idea, reason }) => api<Idea>(`/ideas/${idea.id}/park`, { method: 'POST', body: { reason } }),
    () => 'parked',
    ({ reason }) => reason,
  );
}

export function useUnparkIdea() {
  return useIdeaStatusMutation<{ idea: Idea }>(
    ({ idea }) => api<Idea>(`/ideas/${idea.id}/unpark`, { method: 'POST' }),
    () => 'new',
    () => null,
  );
}

export function useDeleteIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idea: Idea) => api<void>(`/ideas/${idea.id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateIdeas(qc),
  });
}

export function useOpenIdeaAsBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (idea: Idea) => api<IdeaOpenBriefResponse>(`/ideas/${idea.id}/brief`, { method: 'POST' }),
    onSuccess: () => {
      void invalidateIdeas(qc);
      void qc.invalidateQueries({ queryKey: ['briefs'] });
    },
  });
}

/* ---------- Plans ---------- */

export function usePlan(productId: string | null, month: string) {
  return useQuery({
    queryKey: planKeys.month(productId ?? 'none', month),
    queryFn: ({ signal }) => api<PlanGetResponse>('/plans', { query: { productId, month }, signal }),
    enabled: Boolean(productId),
  });
}

export function usePlanChecks(planId: string | null) {
  return useQuery({
    queryKey: planKeys.checks(planId ?? 'none'),
    queryFn: ({ signal }) => api<PlanChecks>(`/plans/${planId}/checks`, { signal }),
    enabled: Boolean(planId),
  });
}

function invalidatePlans(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: planKeys.all });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { productId: string; month: string }) => api<PlanView>('/plans', { method: 'POST', body: input }),
    onSuccess: () => invalidatePlans(qc),
  });
}

export function useAddPlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, input }: { planId: string; input: PlanItemCreateInput }) =>
      api<PlanItemView>(`/plans/${planId}/items`, { method: 'POST', body: input }),
    onSuccess: () => invalidatePlans(qc),
  });
}

/** Drag and drop calls this: the piece moves at once, and moves back if the server says no. */
export function useUpdatePlanItem(productId: string, month: string) {
  const qc = useQueryClient();
  const key = planKeys.month(productId, month);
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: PlanItemUpdateInput }) =>
      api<PlanItemView>(`/plan-items/${itemId}`, { method: 'PATCH', body: input }),
    onMutate: async ({ itemId, input }) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const previous = qc.getQueryData<PlanGetResponse>(key);
      if (previous?.plan) {
        const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<PlanItemView>;
        qc.setQueryData<PlanGetResponse>(key, {
          plan: { ...previous.plan, items: previous.plan.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => invalidatePlans(qc),
  });
}

export function useDeletePlanItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => api<void>(`/plan-items/${itemId}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePlans(qc),
  });
}

export function useFreezePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => api<PlanFreezeResponse>(`/plans/${planId}/freeze`, { method: 'POST' }),
    onSuccess: () => {
      void invalidatePlans(qc);
      void invalidateIdeas(qc);
      void qc.invalidateQueries({ queryKey: ['briefs'] });
    },
  });
}

export function useUnfreezePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) => api<PlanView>(`/plans/${planId}/unfreeze`, { method: 'POST' }),
    onSuccess: () => invalidatePlans(qc),
  });
}

/* ---------- Occasions ---------- */

export function useOccasions(from: string, to: string, productId: string | null) {
  return useQuery({
    queryKey: occasionKeys.range(from, to, productId),
    queryFn: ({ signal }) => api<ListResponse<Occasion>>('/occasions', { query: { from, to, productId }, signal }),
    enabled: Boolean(productId),
  });
}

export function useCreateOccasion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OccasionCreateInput) => api<Occasion>('/occasions', { method: 'POST', body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: occasionKeys.all });
      void invalidatePlans(qc);
    },
  });
}

