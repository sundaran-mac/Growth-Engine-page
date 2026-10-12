/** Test fixtures for the Publish screens (used by *.test.tsx only). */
import type { PostView, PublishBriefSummary } from '@growth-desk/contract';

export const BRIEF_ID = '11111111-1111-4111-8111-111111111111';

export function makePost(over: Partial<PostView> & Pick<PostView, 'id' | 'platform'>): PostView {
  return {
    briefId: BRIEF_ID,
    briefVersion: 2,
    channelAccountId: '22222222-2222-4222-8222-222222222222',
    assetId: '33333333-3333-4333-8333-333333333333',
    format: '9:16 · 58 s',
    caption: 'Sixty seconds with Elan',
    languages: ['en', 'ta'],
    scheduledAt: '2026-10-15T14:00:00.000Z',
    audienceTz: 'Asia/Kolkata',
    status: 'draft',
    externalId: null,
    liveUrl: null,
    trackedUrl: null,
    error: null,
    publishedAt: null,
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
    channel: {
      id: '22222222-2222-4222-8222-222222222222',
      platform: over.platform,
      displayName: 'Humini Live',
      handle: null,
      status: 'connected',
    },
    how: 'auto',
    asset: null,
    ...over,
  };
}

export const POSTS: PostView[] = [
  makePost({ id: 'a0000000-0000-4000-8000-000000000001', platform: 'instagram' }),
  makePost({ id: 'a0000000-0000-4000-8000-000000000002', platform: 'youtube', languages: ['en'] }),
  makePost({
    id: 'a0000000-0000-4000-8000-000000000003',
    platform: 'linkedin',
    how: 'needs_approval',
    format: '4:5 native',
    channel: {
      id: 'c3',
      platform: 'linkedin',
      displayName: 'Elan',
      handle: null,
      status: 'needs_approval',
    },
  }),
  makePost({
    id: 'a0000000-0000-4000-8000-000000000004',
    platform: 'facebook',
    how: 'not_connected',
  }),
  makePost({
    id: 'a0000000-0000-4000-8000-000000000005',
    platform: 'whatsapp',
    how: 'reminder',
    status: 'manual_pending',
    format: '9:16 file',
  }),
  makePost({
    id: 'a0000000-0000-4000-8000-000000000006',
    platform: 'instagram',
    status: 'failed',
    error: 'PLATFORM_ERROR: Media upload timed out',
  }),
];

export function makeSummary(allowed: boolean): PublishBriefSummary {
  return {
    brief: {
      id: BRIEF_ID,
      productId: '44444444-4444-4444-8444-444444444444',
      code: 'REEL-031',
      title: '60 seconds with Elan',
      kind: 'reel',
      mode: 'M1',
      stage: allowed ? 'approved' : 'reviewed',
      version: 2,
      channels: ['instagram', 'youtube', 'linkedin', 'facebook', 'whatsapp'],
    },
    gate: allowed
      ? { allowed: true, reason: null, claims: 'approved', brand: 'approved' }
      : {
          allowed: false,
          reason: 'The brand gate has not approved version 2.',
          claims: 'approved',
          brand: 'pending',
        },
    autoSchedule: true,
    timezone: 'Asia/Kolkata',
    launchDate: null,
    bestWindow: {
      rule: 'starting',
      text: 'Weeks 1 to 4 use the starting rule: reels 6 to 9 am or 7 to 10 pm.',
      windows: [],
    },
  };
}
