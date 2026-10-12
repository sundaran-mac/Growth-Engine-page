/**
 * Test fixtures for MAKE integration tests. Kept in a .test.ts file so the build skips it;
 * the one test at the bottom checks the fixtures themselves.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BriefStage } from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { assets, briefs, productKits, products } from '../../db/schema/index.js';
import {
  addMember,
  createTestProduct,
  createTestUser,
  truncateAll,
  type TestUser,
} from '../../../test/helpers.js';
import { insertBrief } from './briefs.service.js';

export const LIVE_KIT = {
  promise: 'Be there for your people, in Joy and Care.',
  behaviours: [
    { text: 'A heart: the owner sees how many, never who', specRef: '006' },
    { text: 'A byte: up to 60 seconds, video or voice, replayable', specRef: '006' },
    { text: 'A call rings only when availability is on; audio first', specRef: '007' },
  ],
  neverSay: ['anonymous', '60-second call', 'call Amma'],
  notBuilt: [{ text: 'Surprise moments (later)', specRef: '013' }],
};

export interface MakeWorld {
  productId: string;
  owner: TestUser;
  maker: TestUser;
  reviewer: TestUser;
  outsider: TestUser;
  viewerMember: TestUser;
  brand: TestUser;
  editor: TestUser;
}

export async function makeWorld(): Promise<MakeWorld> {
  const product = await createTestProduct({ name: 'Humini Live' });
  const owner = await createTestUser({ name: 'Live Owner', role: 'member' });
  const maker = await createTestUser({ name: 'Jeeva Santiago', role: 'member' });
  const reviewer = await createTestUser({ name: 'Test Er', role: 'member' });
  const outsider = await createTestUser({ name: 'Out Sider', role: 'member' });
  const viewerMember = await createTestUser({ name: 'View Er', role: 'viewer' });
  const brand = await createTestUser({ name: 'Elan', role: 'member', isBrandApprover: true });
  const editor = await createTestUser({ name: 'Ed Itor', role: 'editor' });
  await db.update(products).set({ ownerId: owner.id }).where(eq(products.id, product.id));
  await addMember(product.id, owner.id, 'owner');
  await addMember(product.id, maker.id, 'maker');
  await addMember(product.id, reviewer.id, 'reviewer');
  await addMember(product.id, viewerMember.id, 'maker');
  await db.insert(productKits).values({ productId: product.id, version: 1, ...LIVE_KIT });
  return { productId: product.id, owner, maker, reviewer, outsider, viewerMember, brand, editor };
}

export async function seedBrief(
  w: MakeWorld,
  opts: {
    stage?: BriefStage;
    hook?: string | null;
    beats?: string[];
    ask?: string | null;
    kind?: 'reel' | 'poster';
  } = {},
) {
  const row = await insertBrief(
    db,
    { productId: w.productId, title: '60 seconds with Elan', kind: opts.kind ?? 'reel', mode: 'M1', channels: ['instagram'] },
    w.maker.id,
  );
  const [updated] = await db
    .update(briefs)
    .set({
      stage: opts.stage ?? 'brief',
      hook: opts.hook === undefined ? 'You are not a bad friend.' : opts.hook,
      beats: opts.beats ?? ['A byte waits for them.', 'Sixty seconds needs no window.'],
      ask: opts.ask === undefined ? 'Send one byte today.' : opts.ask,
      frozenAt: opts.stage && opts.stage !== 'brief' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(briefs.id, row.id))
    .returning();
  return updated!;
}

export async function seedAsset(
  briefId: string,
  opts: { status?: 'uploading' | 'ready' | 'failed'; kind?: 'video' | 'poster' | 'caption' | 'cutdown'; uploadId?: string | null; sizeBytes?: number; briefVersion?: number } = {},
) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(assets)
    .values({
      id,
      briefId,
      kind: opts.kind ?? 'video',
      ratio: opts.kind === 'caption' ? null : '9:16',
      storageKey: `products/p/briefs/${briefId}/${id}/master.mp4`,
      fileName: 'master.mp4',
      mimeType: 'video/mp4',
      sizeBytes: opts.sizeBytes ?? 1000,
      status: opts.status ?? 'ready',
      uploadId: opts.uploadId ?? null,
      briefVersion: opts.briefVersion ?? 1,
    })
    .returning();
  return row!;
}

describe('make fixtures', () => {
  beforeEach(truncateAll);
  it('builds a product with a kit, members and a brief', async () => {
    const w = await makeWorld();
    const brief = await seedBrief(w, { stage: 'frozen' });
    expect(brief.code).toMatch(/^REEL-\d{3}$/);
    expect(brief.claimsApproverId).toBe(w.owner.id);
    expect(brief.brandApproverId).toBe(w.brand.id);
    expect((await seedAsset(brief.id)).status).toBe('ready');
  });
});
