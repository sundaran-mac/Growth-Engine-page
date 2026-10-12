/**
 * TanStack Query hooks for the PUBLISH module. Server state only; no Zustand here.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelAccountView,
  ListResponse,
  MarkPostedRequest,
  OAuthPlatform,
  OAuthStartResponse,
  Platform,
  PostMediaUrl,
  PostView,
  PublishBriefSummary,
  PublishQueueItem,
  ScheduleAllResponse,
  TrackedLink,
  UpdatePostRequest,
} from '@growth-desk/contract';
import { http } from '@/lib/api';
import { needsPolling } from './format';

export type PublishQueueStage = 'approved' | 'scheduled' | 'live';

export const publishKeys = {
  all: ['publish'] as const,
  queue: (productId: string | null, stage: PublishQueueStage | undefined, offset: number) =>
    ['publish', 'queue', productId, stage ?? 'all', offset] as const,
  summary: (briefId: string) => ['publish', 'summary', briefId] as const,
  posts: (briefId: string) => ['publish', 'posts', briefId] as const,
  trackedLink: (postId: string) => ['publish', 'tracked-link', postId] as const,
  channelAccounts: (productId: string | null, platform: Platform | undefined) =>
    ['publish', 'channel-accounts', productId ?? 'all', platform ?? 'all'] as const,
};

export const QUEUE_PAGE_SIZE = 50;

export function usePublishQueue(
  productId: string | null,
  stage: PublishQueueStage | undefined,
  offset = 0,
) {
  return useQuery({
    queryKey: publishKeys.queue(productId, stage, offset),
    queryFn: ({ signal }) =>
      http.get<ListResponse<PublishQueueItem>>(
        '/publish/queue',
        { productId, stage, limit: QUEUE_PAGE_SIZE, offset },
        signal,
      ),
    enabled: Boolean(productId),
  });
}

export function usePublishSummary(briefId: string | undefined) {
  return useQuery({
    queryKey: publishKeys.summary(briefId ?? ''),
    queryFn: ({ signal }) =>
      http.get<PublishBriefSummary>(`/publish/briefs/${briefId}`, undefined, signal),
    enabled: Boolean(briefId),
  });
}

/** Posts of a brief. Polls every 5 s while a row is publishing or due within a minute. */
export function useBriefPosts(briefId: string | undefined) {
  return useQuery({
    queryKey: publishKeys.posts(briefId ?? ''),
    queryFn: ({ signal }) =>
      http.get<ListResponse<PostView>>(`/briefs/${briefId}/posts`, undefined, signal),
    enabled: Boolean(briefId),
    refetchInterval: (query) => (needsPolling(query.state.data?.items) ? 5_000 : false),
  });
}

export function useTrackedLink(postId: string | null) {
  return useQuery({
    queryKey: publishKeys.trackedLink(postId ?? ''),
    queryFn: ({ signal }) =>
      http.get<TrackedLink>(`/posts/${postId}/tracked-link`, undefined, signal),
    enabled: Boolean(postId),
    staleTime: 5 * 60_000,
  });
}

export function useChannelAccounts(productId?: string | null, platform?: Platform) {
  return useQuery({
    queryKey: publishKeys.channelAccounts(productId ?? null, platform),
    queryFn: ({ signal }) =>
      http.get<ListResponse<ChannelAccountView>>(
        '/channel-accounts',
        { productId: productId ?? undefined, platform, limit: 100 },
        signal,
      ),
  });
}

/** Refreshes every Publish query that a post change can affect. */
function useInvalidatePublish(briefId: string | undefined) {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      briefId ? qc.invalidateQueries({ queryKey: publishKeys.posts(briefId) }) : Promise.resolve(),
      briefId
        ? qc.invalidateQueries({ queryKey: publishKeys.summary(briefId) })
        : Promise.resolve(),
      qc.invalidateQueries({ queryKey: ['publish', 'queue'] }),
    ]);
  };
}

const silent = { silent: true } as const;

export function useUpdatePost(briefId: string | undefined) {
  const invalidate = useInvalidatePublish(briefId);
  return useMutation({
    meta: silent,
    mutationFn: ({ postId, body }: { postId: string; body: UpdatePostRequest }) =>
      http.patch<PostView>(`/posts/${postId}`, body),
    onSuccess: invalidate,
  });
}

export function useScheduleAll(briefId: string | undefined) {
  const invalidate = useInvalidatePublish(briefId);
  return useMutation({
    meta: silent,
    mutationFn: () => http.post<ScheduleAllResponse>(`/briefs/${briefId}/posts/schedule-all`),
    onSuccess: invalidate,
  });
}

export type PostAction = 'post-now' | 'retry' | 'cancel';

export function usePostAction(briefId: string | undefined) {
  const invalidate = useInvalidatePublish(briefId);
  return useMutation({
    meta: silent,
    mutationFn: ({ postId, action }: { postId: string; action: PostAction }) =>
      http.post<PostView>(`/posts/${postId}/${action}`),
    onSuccess: invalidate,
  });
}

export function useMarkPosted(briefId: string | undefined) {
  const invalidate = useInvalidatePublish(briefId);
  return useMutation({
    meta: silent,
    mutationFn: ({ postId, body }: { postId: string; body: MarkPostedRequest }) =>
      http.post<PostView>(`/posts/${postId}/mark-posted`, body),
    onSuccess: invalidate,
  });
}

/** Fetches a short-lived download link for the file of a post. */
export function useMediaUrl() {
  return useMutation({
    meta: silent,
    mutationFn: (postId: string) => http.get<PostMediaUrl>(`/posts/${postId}/media-url`),
  });
}

export function useDisconnectChannel() {
  const qc = useQueryClient();
  return useMutation({
    meta: silent,
    mutationFn: (accountId: string) => http.delete<void>(`/channel-accounts/${accountId}`),
    // The Integrations screen (PRODUCTS) lists the same accounts under 'integrations'.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['publish', 'channel-accounts'] }),
        qc.invalidateQueries({ queryKey: ['integrations'] }),
      ]),
  });
}

/**
 * Starts an OAuth connect: asks the API for the provider URL, then leaves the app for it.
 * The provider sends the browser back to /integrations?connected=<platform> or ?error=<code>.
 */
export function useStartOAuth(
  navigate: (url: string) => void = (url) => window.location.assign(url),
) {
  return useMutation({
    meta: silent,
    mutationFn: ({
      platform,
      productId,
    }: {
      platform: OAuthPlatform;
      productId?: string | undefined;
    }) => http.get<OAuthStartResponse>(`/integrations/oauth/${platform}/start`, { productId }),
    onSuccess: (res) => navigate(res.url),
  });
}
