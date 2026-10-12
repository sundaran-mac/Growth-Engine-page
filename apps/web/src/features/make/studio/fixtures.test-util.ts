import type { MakeAsset, Brief } from '@growth-desk/contract';

export const BRIEF_ID = '11111111-1111-4111-8111-111111111111';
export const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';

export function makeBrief(over: Partial<Brief> = {}): Brief {
  return {
    id: BRIEF_ID,
    code: 'REEL-031',
    kind: 'reel',
    productId: PRODUCT_ID,
    ideaId: null,
    title: '60 seconds with Elan, ep. 1',
    mode: 'M1',
    stage: 'frozen',
    hook: '“You are not a bad friend. You are doing arithmetic.”',
    beats: ['Beat one.', 'Beat two.', 'Beat three.'],
    ask: 'Send one byte.',
    ratios: ['9:16', '4:5'],
    captionLanguages: ['en', 'ta'],
    channels: ['instagram'],
    owner: null,
    claimsApprover: null,
    brandApprover: null,
    version: 1,
    claimFlags: [],
    claims: [],
    claudeSuggestions: { captions: [], altHooks: [], bRoll: [], generatedAt: null },
    frozenAt: '2026-10-10T10:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...over,
  };
}

export function makeAsset(over: Partial<MakeAsset> = {}): MakeAsset {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    briefId: BRIEF_ID,
    kind: 'video',
    ratio: '9:16',
    storageKey: 'products/p/briefs/b/a/master.mp4',
    fileName: 'master.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 48_300_000,
    durationMs: 58_000,
    width: 1080,
    height: 1920,
    status: 'ready',
    licence: 'Licensed track',
    consentOnFile: true,
    aiGenerated: false,
    briefVersion: 1,
    loudnessLufs: -14,
    createdBy: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    ...over,
  };
}
