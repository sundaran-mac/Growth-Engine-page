/**
 * TanStack Query hooks for Review and Approvals (GATES module).
 * Keys start with 'review' or 'approvals'. The sidebar badge key (['approvals', 'waiting-count'])
 * also starts with 'approvals', so invalidating approvals refreshes the badge.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApprovalDetail,
  ApprovalListItem,
  AssetUrlResponse,
  ChecklistKey,
  CreateReviewCommentRequest,
  DecideApprovalRequest,
  DecideApprovalResponse,
  ListResponse,
  ReviewComment,
  ReviewDetail,
  ReviewQueueItem,
  SendBackResponse,
  SendForApprovalResponse,
  UpdateReviewCommentRequest,
} from '@growth-desk/contract';
import { api } from '@/lib/api';

export const gatesKeys = {
  reviewAll: ['review'] as const,
  queue: (productId: string | null) => ['review', 'queue', { productId }] as const,
  review: (briefId: string) => ['review', 'detail', briefId] as const,
  comments: (briefId: string) => ['review', 'comments', briefId] as const,
  approvalsAll: ['approvals'] as const,
  approvals: (scope: 'mine' | 'all') => ['approvals', 'list', { scope }] as const,
  approval: (id: string) => ['approvals', 'detail', id] as const,
  assetUrl: (assetId: string) => ['review', 'asset-url', assetId] as const,
};

/* ---------- Review ---------- */

export function useReviewQueue(productId: string | null) {
  return useQuery({
    queryKey: gatesKeys.queue(productId),
    queryFn: ({ signal }) =>
      api<ListResponse<ReviewQueueItem>>('/review/queue', {
        query: { productId, limit: 100 },
        signal,
      }),
    enabled: Boolean(productId),
  });
}

export function useReview(briefId: string | undefined) {
  return useQuery({
    queryKey: gatesKeys.review(briefId ?? ''),
    queryFn: ({ signal }) => api<ReviewDetail>(`/briefs/${briefId}/review`, { signal }),
    enabled: Boolean(briefId),
  });
}

export function useReviewComments(briefId: string | undefined) {
  return useQuery({
    queryKey: gatesKeys.comments(briefId ?? ''),
    queryFn: ({ signal }) =>
      api<ListResponse<ReviewComment>>(`/briefs/${briefId}/comments`, { signal }),
    enabled: Boolean(briefId),
  });
}

/** Presigned URL for the preview (MAKE's endpoint). Re-fetched before it expires. */
export function useAssetUrl(assetId: string | null | undefined) {
  return useQuery({
    queryKey: gatesKeys.assetUrl(assetId ?? ''),
    queryFn: ({ signal }) => api<AssetUrlResponse>(`/assets/${assetId}/url`, { signal }),
    enabled: Boolean(assetId),
    staleTime: 4 * 60_000,
    retry: false,
    meta: { silent: true },
  });
}

export function useTickChecklist(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { version: number; key: ChecklistKey; done: boolean }) =>
      api<ReviewDetail>(`/briefs/${briefId}/review/checklist`, {
        method: 'PATCH',
        body: { version: vars.version, items: [{ key: vars.key, done: vars.done }] },
      }),
    // Optimistic tick: the box flips at once and rolls back on failure.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: gatesKeys.review(briefId) });
      const previous = qc.getQueryData<ReviewDetail>(gatesKeys.review(briefId));
      if (previous) {
        const items = previous.checklist.items.map((i) =>
          i.key === vars.key ? { ...i, done: vars.done } : i,
        );
        const done = items.filter((i) => i.done).length;
        qc.setQueryData<ReviewDetail>(gatesKeys.review(briefId), {
          ...previous,
          checklist: { ...previous.checklist, items, done, complete: done === items.length },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(gatesKeys.review(briefId), ctx.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(gatesKeys.review(briefId), data);
      void qc.invalidateQueries({ queryKey: ['review', 'queue'] });
    },
    meta: { silent: true },
  });
}

export function useCreateComment(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateReviewCommentRequest) =>
      api<ReviewComment>(`/briefs/${briefId}/comments`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gatesKeys.comments(briefId) });
      void qc.invalidateQueries({ queryKey: ['review', 'queue'] });
    },
    meta: { silent: true },
  });
}

export function useUpdateComment(briefId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateReviewCommentRequest & { id: string }) =>
      api<ReviewComment>(`/comments/${id}`, { method: 'PATCH', body }),
    onSuccess: (comment) => {
      qc.setQueryData<ListResponse<ReviewComment>>(gatesKeys.comments(briefId), (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((c) => {
                if (c.id === comment.id) return comment;
                // Resolve and reopen act on the whole thread.
                if (c.parentId === comment.id) {
                  return { ...c, resolved: comment.resolved, resolvedAt: comment.resolvedAt };
                }
                return c;
              }),
            }
          : prev,
      );
      void qc.invalidateQueries({ queryKey: gatesKeys.comments(briefId) });
      void qc.invalidateQueries({ queryKey: ['review', 'queue'] });
    },
    meta: { silent: true },
  });
}

function useInvalidateGates() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: gatesKeys.reviewAll }),
      qc.invalidateQueries({ queryKey: gatesKeys.approvalsAll }),
      qc.invalidateQueries({ queryKey: ['briefs'] }),
      qc.invalidateQueries({ queryKey: ['notifications'] }),
    ]);
}

export function useSendForApproval(briefId: string) {
  const invalidate = useInvalidateGates();
  return useMutation({
    mutationFn: (version: number) =>
      api<SendForApprovalResponse>(`/briefs/${briefId}/send-for-approval`, {
        method: 'POST',
        body: { version },
      }),
    onSuccess: () => invalidate(),
    meta: { silent: true },
  });
}

export function useSendBack(briefId: string) {
  const invalidate = useInvalidateGates();
  return useMutation({
    mutationFn: (vars: { version: number; note: string }) =>
      api<SendBackResponse>(`/briefs/${briefId}/send-back`, { method: 'POST', body: vars }),
    onSuccess: () => invalidate(),
    meta: { silent: true },
  });
}

/* ---------- Approvals ---------- */

export function useApprovalQueue(scope: 'mine' | 'all') {
  return useQuery({
    queryKey: gatesKeys.approvals(scope),
    queryFn: ({ signal }) =>
      api<ListResponse<ApprovalListItem>>('/approvals', {
        query: { decision: 'pending', mine: scope === 'mine', limit: 100 },
        signal,
      }),
    refetchInterval: 60_000,
  });
}

export function useApproval(id: string | null) {
  return useQuery({
    queryKey: gatesKeys.approval(id ?? ''),
    queryFn: ({ signal }) => api<ApprovalDetail>(`/approvals/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useDecideApproval() {
  const invalidate = useInvalidateGates();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: DecideApprovalRequest & { id: string }) =>
      api<DecideApprovalResponse>(`/approvals/${id}/decide`, { method: 'POST', body }),
    onSuccess: () => Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['publish'] })]),
    meta: { silent: true },
  });
}
