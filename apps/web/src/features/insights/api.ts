/**
 * TanStack Query hooks for the INSIGHTS screens (Home, Analytics, Sales) and the notification bell.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AnalyticsByChannel,
  AnalyticsByMode,
  AnalyticsPostsResponse,
  AnalyticsRange,
  AnalyticsSummary,
  CreateKeywordRuleRequest,
  CreateLeadActivityRequest,
  CreateLeadRequest,
  DashboardResponse,
  GenerateNoteRequest,
  KeywordEventListResponse,
  KeywordRuleListResponse,
  KeywordRuleView,
  LatestNoteResponse,
  LeadActivity,
  LeadActivityListResponse,
  LeadListResponse,
  LeadStage,
  LeadView,
  MoveLeadRequest,
  UpdateKeywordRuleRequest,
  UpdateLeadRequest,
  WeeklyNote,
} from '@growth-desk/contract';
import { api, isApiError } from '@/lib/api';

export const insightsKeys = {
  all: ['insights'] as const,
  dashboard: (productId: string | null, tz: string) =>
    ['insights', 'dashboard', { productId, tz }] as const,
  analytics: (kind: string, productId: string | null, days: number, extra?: object) =>
    ['insights', 'analytics', kind, { productId, days, ...extra }] as const,
  note: (productId: string | null) => ['insights', 'note', { productId }] as const,
  leads: ['leads'] as const,
  leadList: (productId: string | null, includeLost: boolean) =>
    ['leads', 'list', { productId, includeLost }] as const,
  leadActivities: (leadId: string) => ['leads', 'activities', leadId] as const,
  keywordRules: (productId: string | null) => ['insights', 'keyword-rules', { productId }] as const,
  keywordEvents: (productId: string | null) =>
    ['insights', 'keyword-events', { productId }] as const,
};

/** 4xx errors are not toasted globally (only 5xx are), so mutations toast them here. */
function toastClientError(fallback: string) {
  return (error: unknown) => {
    if (isApiError(error) && error.isClientError && !error.isUnauthorized) {
      toast.error(error.title || fallback, { description: error.detail });
    }
  };
}

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

/* ---------- Home ---------- */

export function useDashboard(productId: string | null) {
  const tz = viewerTimeZone();
  return useQuery({
    queryKey: insightsKeys.dashboard(productId, tz),
    queryFn: ({ signal }) =>
      api<DashboardResponse>('/dashboard', { query: { productId, tz }, signal }),
    enabled: productId !== null,
    refetchInterval: 60_000,
  });
}

/* ---------- Analytics ---------- */

export function useAnalyticsSummary(productId: string | null, days: AnalyticsRange) {
  return useQuery({
    queryKey: insightsKeys.analytics('summary', productId, days),
    queryFn: ({ signal }) =>
      api<AnalyticsSummary>('/analytics/summary', { query: { productId, days }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsByChannel(productId: string | null, days: AnalyticsRange) {
  return useQuery({
    queryKey: insightsKeys.analytics('by-channel', productId, days),
    queryFn: ({ signal }) =>
      api<AnalyticsByChannel>('/analytics/by-channel', { query: { productId, days }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsByMode(productId: string | null, days: AnalyticsRange) {
  return useQuery({
    queryKey: insightsKeys.analytics('by-mode', productId, days),
    queryFn: ({ signal }) =>
      api<AnalyticsByMode>('/analytics/by-mode', { query: { productId, days }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsPosts(
  productId: string | null,
  days: AnalyticsRange,
  page: { limit: number; offset: number },
) {
  return useQuery({
    queryKey: insightsKeys.analytics('posts', productId, days, page),
    queryFn: ({ signal }) =>
      api<AnalyticsPostsResponse>('/analytics/posts', {
        query: { productId, days, limit: page.limit, offset: page.offset, sort: 'value' },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

/* ---------- Monday note ---------- */

export function useLatestNote(productId: string | null, enabled = true) {
  return useQuery({
    queryKey: insightsKeys.note(productId),
    queryFn: ({ signal }) =>
      api<LatestNoteResponse>('/notes/latest', { query: { productId }, signal }),
    enabled,
  });
}

export function useGenerateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateNoteRequest) =>
      api<WeeklyNote>('/notes/generate', { method: 'POST', body: input }),
    onSuccess: () => {
      toast.success('Monday note is ready');
      void qc.invalidateQueries({ queryKey: ['insights'] });
    },
    onError: toastClientError('Could not write the note'),
  });
}

/* ---------- Leads ---------- */

export function useLeads(productId: string | null, includeLost: boolean) {
  return useQuery({
    queryKey: insightsKeys.leadList(productId, includeLost),
    queryFn: ({ signal }) =>
      api<LeadListResponse>('/leads', {
        query: { productId, includeLost: includeLost ? 'true' : undefined, limit: 100 },
        signal,
      }),
  });
}

export function useLeadActivities(leadId: string | null) {
  return useQuery({
    queryKey: insightsKeys.leadActivities(leadId ?? 'none'),
    queryFn: ({ signal }) =>
      api<LeadActivityListResponse>(`/leads/${leadId}/activities`, {
        query: { limit: 50 },
        signal,
      }),
    enabled: leadId !== null,
  });
}

function replaceLead(
  list: LeadListResponse | undefined,
  lead: LeadView,
): LeadListResponse | undefined {
  if (!list) return list;
  return { ...list, items: list.items.map((l) => (l.id === lead.id ? lead : l)) };
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadRequest) =>
      api<LeadView>('/leads', { method: 'POST', body: input }),
    onSuccess: (lead) => {
      toast.success(`Lead added: ${lead.organisation}`);
      void qc.invalidateQueries({ queryKey: insightsKeys.leads });
      void qc.invalidateQueries({ queryKey: ['insights', 'dashboard'] });
    },
    onError: toastClientError('Could not add the lead'),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeadRequest }) =>
      api<LeadView>(`/leads/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (lead) => {
      toast.success('Lead saved');
      qc.setQueriesData<LeadListResponse>({ queryKey: [...insightsKeys.leads, 'list'] }, (old) =>
        replaceLead(old, lead),
      );
      void qc.invalidateQueries({ queryKey: insightsKeys.leadActivities(lead.id) });
    },
    onError: toastClientError('Could not save the lead'),
  });
}

/** Moves a lead with an optimistic board update; rolls back on failure. */
export function useMoveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveLeadRequest; from: LeadStage }) =>
      api<LeadView>(`/leads/${id}/move`, { method: 'POST', body: input }),
    onMutate: async ({ id, input }) => {
      await qc.cancelQueries({ queryKey: insightsKeys.leads });
      const snapshot = qc.getQueriesData<LeadListResponse>({
        queryKey: [...insightsKeys.leads, 'list'],
      });
      qc.setQueriesData<LeadListResponse>({ queryKey: [...insightsKeys.leads, 'list'] }, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((l) => (l.id === id ? { ...l, stage: input.stage } : l)),
            }
          : old,
      );
      return { snapshot };
    },
    onError: (error, _vars, ctx) => {
      ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data));
      toastClientError('Could not move the lead')(error);
    },
    onSuccess: (lead) => {
      qc.setQueriesData<LeadListResponse>({ queryKey: [...insightsKeys.leads, 'list'] }, (old) =>
        replaceLead(old, lead),
      );
      void qc.invalidateQueries({ queryKey: insightsKeys.leadActivities(lead.id) });
      void qc.invalidateQueries({ queryKey: ['insights', 'dashboard'] });
    },
  });
}

export function useAddLeadActivity(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLeadActivityRequest) =>
      api<LeadActivity>(`/leads/${leadId}/activities`, { method: 'POST', body: input }),
    onSuccess: () => {
      toast.success('Logged');
      void qc.invalidateQueries({ queryKey: insightsKeys.leadActivities(leadId) });
    },
    onError: toastClientError('Could not log it'),
  });
}

/* ---------- Keyword replies ---------- */

export function useKeywordRules(productId: string | null, enabled = true) {
  return useQuery({
    queryKey: insightsKeys.keywordRules(productId),
    queryFn: ({ signal }) =>
      api<KeywordRuleListResponse>('/keyword-rules', { query: { productId }, signal }),
    enabled,
  });
}

export function useKeywordEvents(productId: string | null, enabled = true) {
  return useQuery({
    queryKey: insightsKeys.keywordEvents(productId),
    queryFn: ({ signal }) =>
      api<KeywordEventListResponse>('/keyword-events', { query: { productId, limit: 30 }, signal }),
    enabled,
  });
}

export function useCreateKeywordRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKeywordRuleRequest) =>
      api<KeywordRuleView>('/keyword-rules', { method: 'POST', body: input }),
    onSuccess: (rule) => {
      toast.success(`Keyword ${rule.keyword} added`);
      void qc.invalidateQueries({ queryKey: ['insights', 'keyword-rules'] });
    },
    onError: toastClientError('Could not add the keyword'),
  });
}

export function useUpdateKeywordRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKeywordRuleRequest }) =>
      api<KeywordRuleView>(`/keyword-rules/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (rule) => {
      toast.success(`Keyword ${rule.keyword} ${rule.active ? 'on' : 'off'}`);
      void qc.invalidateQueries({ queryKey: ['insights', 'keyword-rules'] });
    },
    onError: toastClientError('Could not change the keyword'),
  });
}

/* ---------- Notifications (the shell bell reads `shellKeys.notifications`) ---------- */

// Moved to the shell so the bell can use them; re-exported here for this feature.
export { useMarkAllNotificationsRead, useMarkNotificationRead } from '@/lib/shell-queries';
