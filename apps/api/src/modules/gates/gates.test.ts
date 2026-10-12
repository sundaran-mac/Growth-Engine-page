/**
 * Integration tests for Review and Approvals (real Postgres, Supertest).
 * SETTINGS and PUBLISH are built in parallel, so their shared functions are mocked here.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvalDetailSchema,
  approvalListItemSchema,
  reviewDetailSchema,
  reviewQueueItemSchema,
  type ClaimFlag,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import {
  approvals,
  assets,
  auditLogs,
  briefs,
  notifications,
  products,
  reviewComments,
} from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { notImplemented } from '../../lib/not-implemented.js';
import {
  addMember,
  createTestProduct,
  createTestUser,
  loginAgent,
  truncateAll,
  type TestUser,
} from '../../../test/helpers.js';

const settingsMock = vi.hoisted(() => ({ getProductSettings: vi.fn() }));
const publishMock = vi.hoisted(() => ({ createDraftPostsForBrief: vi.fn() }));

vi.mock('../settings/shared.js', () => ({
  getProductSettings: settingsMock.getProductSettings,
  buildProductContext: vi.fn(),
  nextFreeSlots: vi.fn(),
}));
vi.mock('../publish/shared.js', () => ({
  createDraftPostsForBrief: publishMock.createDraftPostsForBrief,
  sendInstagramPrivateReply: vi.fn(),
}));

const { escalateDueApprovals } = await import('./service.js');

const app = createApp();
const API = '/api/v1';
const HOUR = 60 * 60 * 1000;

const PASS_FLAGS: ClaimFlag[] = [
  { rule: 'never_say', status: 'pass', message: 'No never-say words', suggestion: null },
];

let codeSeq = 100;

interface World {
  productId: string;
  owner: TestUser;
  backup: TestUser;
  brand: TestUser;
  brandBackup: TestUser;
  maker: TestUser;
  reviewer: TestUser;
  outsider: TestUser;
  admin: TestUser;
}

async function makeWorld(opts: { backup?: boolean } = {}): Promise<World> {
  const owner = await createTestUser({ name: 'Meera Owner' });
  const backup = await createTestUser({ name: 'Bala Backup' });
  const brand = await createTestUser({ name: 'Elan Brand', isBrandApprover: true });
  const brandBackup = await createTestUser({ name: 'Zara Brand', isBrandApprover: true });
  const maker = await createTestUser({ name: 'Jeeva Maker' });
  const reviewer = await createTestUser({ name: 'Kavya Tester' });
  const outsider = await createTestUser({ name: 'Other Person' });
  const admin = await createTestUser({ name: 'Sundaran Admin', role: 'admin' });
  const product = await createTestProduct({ name: 'Humini Live' });
  await db
    .update(products)
    .set({ ownerId: owner.id, backupId: opts.backup === false ? null : backup.id })
    .where(eq(products.id, product.id));
  await addMember(product.id, owner.id, 'owner');
  await addMember(product.id, maker.id, 'maker');
  await addMember(product.id, reviewer.id, 'reviewer');
  return {
    productId: product.id,
    owner,
    backup,
    brand,
    brandBackup,
    maker,
    reviewer,
    outsider,
    admin,
  };
}

async function makeBrief(
  w: World,
  over: Partial<typeof briefs.$inferInsert> = {},
  asset: Partial<typeof assets.$inferInsert> | null = {},
) {
  codeSeq += 1;
  const [b] = await db
    .insert(briefs)
    .values({
      code: `REEL-${codeSeq}`,
      productId: w.productId,
      title: '60 seconds with Elan',
      mode: 'M1',
      stage: 'made',
      captionLanguages: ['en', 'ta'],
      ownerId: w.maker.id,
      claimFlags: PASS_FLAGS,
      claims: [{ text: 'A byte is 60 seconds of you', source: 'spec 006', check: 'matches' }],
      ...over,
    })
    .returning();
  if (asset) {
    await db.insert(assets).values({
      briefId: b!.id,
      kind: 'video',
      ratio: '9:16',
      storageKey: `briefs/${b!.id}/${randomUUID()}.mp4`,
      mimeType: 'video/mp4',
      durationMs: 58_000,
      status: 'ready',
      licence: 'Licensed track',
      consentOnFile: true,
      ...asset,
    });
  }
  return b!;
}

const MANUAL_TICKS = [
  { key: 'captions_safe_zone', done: true },
  { key: 'real_screens', done: true },
  { key: 'loudness', done: true },
];

async function readyForApproval(w: World) {
  const brief = await makeBrief(w);
  const maker = await loginAgent(app, w.maker);
  await maker
    .patch(`${API}/briefs/${brief.id}/review/checklist`)
    .send({ version: 1, items: MANUAL_TICKS })
    .expect(200);
  return { brief, maker };
}

async function sendForApproval(w: World) {
  const { brief, maker } = await readyForApproval(w);
  const res = await maker
    .post(`${API}/briefs/${brief.id}/send-for-approval`)
    .send({ version: 1 })
    .expect(201);
  const list = res.body.approvals as { id: string; gate: 'claims' | 'brand' }[];
  return {
    brief,
    maker,
    claimsId: list.find((a) => a.gate === 'claims')!.id,
    brandId: list.find((a) => a.gate === 'brand')!.id,
  };
}

beforeEach(async () => {
  await truncateAll();
  settingsMock.getProductSettings.mockReset();
  settingsMock.getProductSettings.mockResolvedValue({
    productId: 'x',
    timezone: 'Asia/Kolkata',
    launchDate: null,
    autoSchedule: true,
    approvalSlaHours: 48,
    utmCampaignPrefix: null,
    trackingBaseUrl: 'https://live.humini.app',
    claudeMonthlyTokenCap: null,
  });
  publishMock.createDraftPostsForBrief.mockReset();
  publishMock.createDraftPostsForBrief.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
});

describe('GET /review/queue', () => {
  it('lists pieces in review for product members with checklist counts', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    await makeBrief(w, { stage: 'brief' });
    await db
      .insert(reviewComments)
      .values({ briefId: b.id, version: 1, authorId: w.reviewer.id, body: 'Cut earlier' });
    const res = await (await loginAgent(app, w.reviewer)).get(`${API}/review/queue`).expect(200);
    expect(res.body.total).toBe(1);
    const item = reviewQueueItemSchema.parse(res.body.items[0]);
    expect(item.brief.id).toBe(b.id);
    expect(item.checklistTotal).toBe(8);
    expect(item.checklistDone).toBe(5);
    expect(item.openComments).toBe(1);
  });

  it('shows nothing to a user outside the product', async () => {
    const w = await makeWorld();
    await makeBrief(w);
    const res = await (await loginAgent(app, w.outsider)).get(`${API}/review/queue`).expect(200);
    expect(res.body).toEqual({ items: [], total: 0 });
  });

  it('needs a session and validates the query', async () => {
    const w = await makeWorld();
    await (await import('supertest')).default(app).get(`${API}/review/queue`).expect(401);
    const res = await (
      await loginAgent(app, w.maker)
    )
      .get(`${API}/review/queue`)
      .query({ productId: 'nope' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /briefs/:id/review and checklist', () => {
  it('returns auto items from data and the master asset', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const res = await (
      await loginAgent(app, w.reviewer)
    )
      .get(`${API}/briefs/${b.id}/review`)
      .expect(200);
    const detail = reviewDetailSchema.parse(res.body);
    expect(detail.master?.mimeType).toBe('video/mp4');
    expect(detail.canReview).toBe(true);
    expect(detail.canSend).toBe(false);
    const byKey = Object.fromEntries(detail.checklist.items.map((i) => [i.key, i]));
    expect(byKey.claim_check).toMatchObject({ auto: true, done: true });
    expect(byKey.consent).toMatchObject({ auto: true, done: true });
    expect(byKey.tracked_link).toMatchObject({ auto: true, done: true });
    expect(byKey.real_screens).toMatchObject({ auto: false, done: false });
  });

  it('fills the loudness item from the master asset reading', async () => {
    const w = await makeWorld();
    const loudness = async (lufs: number | null) => {
      const b = await makeBrief(w, {}, { loudnessLufs: lufs });
      const res = await (await loginAgent(app, w.reviewer)).get(`${API}/briefs/${b.id}/review`).expect(200);
      return reviewDetailSchema
        .parse(res.body)
        .checklist.items.find((i) => i.key === 'loudness');
    };
    expect(await loudness(-14)).toMatchObject({ auto: true, done: true });
    expect(await loudness(-13.2)).toMatchObject({ auto: true, done: true });
    expect(await loudness(-15)).toMatchObject({ auto: true, done: true });
    expect(await loudness(-11.8)).toMatchObject({ auto: true, done: false });
    expect(await loudness(-16.5)).toMatchObject({ auto: true, done: false });
    expect(await loudness(null)).toMatchObject({ auto: false, done: false });
  });

  it('falls back when SETTINGS is not built yet (no tracking URL)', async () => {
    settingsMock.getProductSettings.mockRejectedValue(notImplemented('getProductSettings'));
    const w = await makeWorld();
    const b = await makeBrief(w);
    const res = await (
      await loginAgent(app, w.maker)
    )
      .get(`${API}/briefs/${b.id}/review`)
      .expect(200);
    const tracked = res.body.checklist.items.find((i: { key: string }) => i.key === 'tracked_link');
    expect(tracked.done).toBe(false);
  });

  it('hides the brief from outsiders and validates the id', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const outsider = await loginAgent(app, w.outsider);
    await outsider.get(`${API}/briefs/${b.id}/review`).expect(404);
    await outsider.get(`${API}/briefs/not-a-uuid/review`).expect(400);
  });

  it('ticks manual items, refuses auto items, stale versions and viewers', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    const ok = await reviewer
      .patch(`${API}/briefs/${b.id}/review/checklist`)
      .send({ version: 1, items: MANUAL_TICKS })
      .expect(200);
    expect(ok.body.checklist).toMatchObject({ done: 8, total: 8, complete: true });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'review.checklist.update'));
    expect(audit).toHaveLength(1);

    const auto = await reviewer
      .patch(`${API}/briefs/${b.id}/review/checklist`)
      .send({ version: 1, items: [{ key: 'claim_check', done: false }] })
      .expect(400);
    expect(auto.body.code).toBe('CHECKLIST_AUTO_ITEM');

    const stale = await reviewer
      .patch(`${API}/briefs/${b.id}/review/checklist`)
      .send({ version: 2, items: MANUAL_TICKS })
      .expect(409);
    expect(stale.body.code).toBe('STALE_VERSION');

    await reviewer
      .patch(`${API}/briefs/${b.id}/review/checklist`)
      .send({ version: 1, items: [{ key: 'bogus', done: true }] })
      .expect(400);

    const viewer = await createTestUser({ role: 'viewer' });
    await addMember(w.productId, viewer.id, 'reviewer');
    await (
      await loginAgent(app, viewer)
    )
      .patch(`${API}/briefs/${b.id}/review/checklist`)
      .send({ version: 1, items: MANUAL_TICKS })
      .expect(403);
  });
});

describe('comments', () => {
  it('creates at a timecode, lists, resolves; only the author edits text', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    const created = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Caption overlaps the Reels UI', timecodeMs: 41_000 })
      .expect(201);
    expect(created.body).toMatchObject({ timecodeMs: 41_000, resolved: false, version: 1 });
    expect(created.body.author.id).toBe(w.reviewer.id);

    const maker = await loginAgent(app, w.maker);
    const list = await maker.get(`${API}/briefs/${b.id}/comments`).expect(200);
    expect(list.body.total).toBe(1);

    const resolved = await maker
      .patch(`${API}/comments/${created.body.id}`)
      .send({ resolved: true })
      .expect(200);
    expect(resolved.body.resolved).toBe(true);
    expect(resolved.body.resolvedAt).not.toBeNull();

    await maker.patch(`${API}/comments/${created.body.id}`).send({ body: 'changed' }).expect(403);
    await reviewer.patch(`${API}/comments/${created.body.id}`).send({ body: 'Edited' }).expect(200);
    await reviewer.patch(`${API}/comments/${created.body.id}`).send({}).expect(400);

    const open = await maker
      .get(`${API}/briefs/${b.id}/comments`)
      .query({ includeResolved: 'false' })
      .expect(200);
    expect(open.body.total).toBe(0);
  });

  it('replies stay one level deep, take the root timecode, and list in thread order', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    const maker = await loginAgent(app, w.maker);
    const late = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Logo too small', timecodeMs: 50_000 })
      .expect(201);
    const root = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Caption overlaps the Reels UI', timecodeMs: 12_000 })
      .expect(201);
    expect(root.body.parentId).toBeNull();
    const reply = await maker
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Moved it up 80 px', parentId: root.body.id, timecodeMs: 30_000 })
      .expect(201);
    expect(reply.body).toMatchObject({ parentId: root.body.id, timecodeMs: 12_000 });
    const nested = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Looks right now', parentId: reply.body.id })
      .expect(201);
    expect(nested.body.parentId).toBe(root.body.id);
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'review.comment.create'), eq(auditLogs.entityId, nested.body.id)));
    expect(audit?.after).toMatchObject({ parentId: root.body.id });

    const list = await maker.get(`${API}/briefs/${b.id}/comments`).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([
      root.body.id,
      reply.body.id,
      nested.body.id,
      late.body.id,
    ]);
    const queue = await reviewer.get(`${API}/review/queue`).expect(200);
    expect(queue.body.items[0].openComments).toBe(2);
  });

  it('refuses a reply to a comment on another brief or an older version', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const other = await makeBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    const elsewhere = await reviewer
      .post(`${API}/briefs/${other.id}/comments`)
      .send({ body: 'On the other piece' })
      .expect(201);
    const cross = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Reply', parentId: elsewhere.body.id })
      .expect(422);
    expect(cross.body.code).toBe('COMMENT_PARENT_INVALID');
    const [old] = await db
      .insert(reviewComments)
      .values({ briefId: b.id, version: 1, authorId: w.reviewer.id, body: 'Old version note' })
      .returning();
    await db.update(briefs).set({ version: 2 }).where(eq(briefs.id, b.id));
    const stale = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Reply', parentId: old!.id })
      .expect(422);
    expect(stale.body.code).toBe('COMMENT_PARENT_INVALID');
    const missing = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Reply', parentId: randomUUID() })
      .expect(422);
    expect(missing.body.code).toBe('COMMENT_PARENT_INVALID');
    await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Reply', parentId: 'nope' })
      .expect(400);
  });

  it('resolving the root resolves the thread; a reply cannot be resolved alone', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const reviewer = await loginAgent(app, w.reviewer);
    const maker = await loginAgent(app, w.maker);
    const root = await reviewer
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Trim the end', timecodeMs: 55_000 })
      .expect(201);
    const reply = await maker
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'Trimmed', parentId: root.body.id })
      .expect(201);
    const alone = await maker
      .patch(`${API}/comments/${reply.body.id}`)
      .send({ resolved: true })
      .expect(422);
    expect(alone.body.code).toBe('COMMENT_IS_REPLY');
    await maker.patch(`${API}/comments/${reply.body.id}`).send({ body: 'Trimmed 2 s' }).expect(200);

    await reviewer.patch(`${API}/comments/${root.body.id}`).send({ resolved: true }).expect(200);
    const all = await maker.get(`${API}/briefs/${b.id}/comments`).expect(200);
    expect(all.body.items.every((c: { resolved: boolean }) => c.resolved)).toBe(true);
    const open = await maker
      .get(`${API}/briefs/${b.id}/comments`)
      .query({ includeResolved: 'false' })
      .expect(200);
    expect(open.body.total).toBe(0);

    const late = await maker
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'One more note', parentId: root.body.id })
      .expect(201);
    expect(late.body.resolved).toBe(true);

    await reviewer.patch(`${API}/comments/${root.body.id}`).send({ resolved: false }).expect(200);
    const reopened = await maker
      .get(`${API}/briefs/${b.id}/comments`)
      .query({ includeResolved: 'false' })
      .expect(200);
    expect(reopened.body.total).toBe(3);
  });

  it('rejects empty bodies, outsiders and viewers', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    await (
      await loginAgent(app, w.reviewer)
    )
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: '  ' })
      .expect(400);
    await (
      await loginAgent(app, w.outsider)
    )
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'hi' })
      .expect(404);
    const viewer = await createTestUser({ role: 'viewer' });
    await addMember(w.productId, viewer.id, 'reviewer');
    await (
      await loginAgent(app, viewer)
    )
      .post(`${API}/briefs/${b.id}/comments`)
      .send({ body: 'hi' })
      .expect(403);
  });
});

describe('POST /briefs/:id/send-for-approval', () => {
  it('needs a complete checklist', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    const res = await (
      await loginAgent(app, w.maker)
    )
      .post(`${API}/briefs/${b.id}/send-for-approval`)
      .send({ version: 1 })
      .expect(422);
    expect(res.body.code).toBe('CHECKLIST_INCOMPLETE');
  });

  it('is not allowed for a product reviewer', async () => {
    const w = await makeWorld();
    const { brief } = await readyForApproval(w);
    await (
      await loginAgent(app, w.reviewer)
    )
      .post(`${API}/briefs/${brief.id}/send-for-approval`)
      .send({ version: 1 })
      .expect(403);
  });

  it('creates both gates with the SLA, moves to reviewed and notifies approvers', async () => {
    const w = await makeWorld();
    const before = Date.now();
    const { brief, claimsId, brandId } = await sendForApproval(w);
    const [b] = await db.select().from(briefs).where(eq(briefs.id, brief.id));
    expect(b!.stage).toBe('reviewed');
    const rows = await db.select().from(approvals).where(eq(approvals.briefId, brief.id));
    expect(rows).toHaveLength(2);
    const claims = rows.find((r) => r.id === claimsId)!;
    const brand = rows.find((r) => r.id === brandId)!;
    expect(claims).toMatchObject({ approverId: w.owner.id, backupId: w.backup.id, version: 1 });
    expect(brand).toMatchObject({ approverId: w.brand.id, backupId: w.brandBackup.id });
    const due = claims.dueAt.getTime() - before;
    expect(due).toBeGreaterThan(47.9 * HOUR);
    expect(due).toBeLessThan(48.1 * HOUR);
    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'approval_requested'));
    expect(notes.map((n) => n.userId).sort()).toEqual([w.owner.id, w.brand.id].sort());
  });

  it('keeps the tracked link open when SETTINGS is not built yet', async () => {
    settingsMock.getProductSettings.mockRejectedValue(notImplemented('getProductSettings'));
    const w = await makeWorld();
    const { brief, maker } = await readyForApproval(w);
    const res = await maker
      .post(`${API}/briefs/${brief.id}/send-for-approval`)
      .send({ version: 1 })
      .expect(422);
    expect(res.body.detail).toContain('Tracked link');
  });

  it('gateSettings falls back to a 24 h SLA only for NOT_IMPLEMENTED', async () => {
    const { gateSettings } = await import('./repo.js');
    settingsMock.getProductSettings.mockRejectedValueOnce(notImplemented('getProductSettings'));
    expect(await gateSettings(randomUUID(), db)).toEqual({
      approvalSlaHours: 24,
      trackingBaseUrl: null,
    });
    settingsMock.getProductSettings.mockRejectedValueOnce(
      new AppError({ status: 404, code: 'NOT_FOUND', title: 'Not found' }),
    );
    await expect(gateSettings(randomUUID(), db)).rejects.toThrow();
  });

  it('refuses a second send and a stale version', async () => {
    const w = await makeWorld();
    const { brief, maker } = await sendForApproval(w);
    const again = await maker
      .post(`${API}/briefs/${brief.id}/send-for-approval`)
      .send({ version: 1 })
      .expect(409);
    expect(again.body.code).toBe('STAGE_NOT_ALLOWED');
    const stale = await maker
      .post(`${API}/briefs/${brief.id}/send-for-approval`)
      .send({ version: 3 })
      .expect(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });
});

describe('POST /briefs/:id/send-back', () => {
  it('needs a note, then bumps the version and keeps the note as a comment', async () => {
    const w = await makeWorld();
    const { brief, maker, claimsId } = await sendForApproval(w);
    await maker
      .post(`${API}/briefs/${brief.id}/send-back`)
      .send({ version: 1, note: ' ' })
      .expect(400);
    const res = await maker
      .post(`${API}/briefs/${brief.id}/send-back`)
      .send({ version: 1, note: 'Hook lands late' })
      .expect(200);
    expect(res.body.brief).toMatchObject({ stage: 'brief', version: 2 });
    const comments = await db
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.briefId, brief.id));
    expect(comments[0]).toMatchObject({
      body: 'Hook lands late',
      version: 1,
      authorLabel: 'Sent back to brief',
    });
    // The old claims approval is stale now.
    const owner = await loginAgent(app, w.owner);
    const detail = await owner.get(`${API}/approvals/${claimsId}`).expect(200);
    expect(detail.body.stale).toBe(true);
    expect(detail.body.canDecide).toBe(false);
  });

  it('refuses a reviewer', async () => {
    const w = await makeWorld();
    const b = await makeBrief(w);
    await (
      await loginAgent(app, w.reviewer)
    )
      .post(`${API}/briefs/${b.id}/send-back`)
      .send({ version: 1, note: 'x' })
      .expect(403);
  });
});

describe('approvals', () => {
  it('counts pending approvals for the sidebar badge (mine only)', async () => {
    const w = await makeWorld();
    await sendForApproval(w);
    const query = { decision: 'pending', mine: 'true', limit: 1 };
    const owner = await (
      await loginAgent(app, w.owner)
    )
      .get(`${API}/approvals`)
      .query(query)
      .expect(200);
    expect(owner.body.total).toBe(1);
    expect(owner.body.items).toHaveLength(1);
    const item = approvalListItemSchema.parse(owner.body.items[0]);
    expect(item).toMatchObject({ gate: 'claims', canDecide: true, stale: false });
    const backup = await (
      await loginAgent(app, w.backup)
    )
      .get(`${API}/approvals`)
      .query(query)
      .expect(200);
    expect(backup.body.total).toBe(0);
    const admin = await (
      await loginAgent(app, w.admin)
    )
      .get(`${API}/approvals`)
      .query(query)
      .expect(200);
    expect(admin.body.total).toBe(0);
    const all = await (
      await loginAgent(app, w.admin)
    )
      .get(`${API}/approvals`)
      .query({ mine: 'false' })
      .expect(200);
    expect(all.body.total).toBe(2);
    const outsiderAll = await (
      await loginAgent(app, w.outsider)
    )
      .get(`${API}/approvals`)
      .query({ mine: 'false' })
      .expect(200);
    expect(outsiderAll.body.total).toBe(0);
    await (
      await loginAgent(app, w.owner)
    )
      .get(`${API}/approvals`)
      .query({ decision: 'maybe' })
      .expect(400);
  });

  it('shows the detail with claims, both gates and the log', async () => {
    const w = await makeWorld();
    const { claimsId } = await sendForApproval(w);
    const res = await (
      await loginAgent(app, w.owner)
    )
      .get(`${API}/approvals/${claimsId}`)
      .expect(200);
    const d = approvalDetailSchema.parse(res.body);
    expect(d.claims).toHaveLength(1);
    expect(d.gates.map((g) => g.gate)).toEqual(['claims', 'brand']);
    expect(d.history).toHaveLength(2);
    await (await loginAgent(app, w.outsider)).get(`${API}/approvals/${claimsId}`).expect(404);
    await (await loginAgent(app, w.owner)).get(`${API}/approvals/${randomUUID()}`).expect(404);
  });

  it('only the named approver decides; admins and early backups cannot', async () => {
    const w = await makeWorld();
    const { claimsId } = await sendForApproval(w);
    const admin = await (
      await loginAgent(app, w.admin)
    )
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(403);
    expect(admin.body.code).toBe('GATE_NOT_ALLOWED');
    await (
      await loginAgent(app, w.backup)
    )
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(403);
    // The brand approver is not on this product and not on this gate: it stays hidden.
    await (
      await loginAgent(app, w.brand)
    )
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(404);
  });

  it('both gates approved: brief approved and draft posts created in the same transaction', async () => {
    const w = await makeWorld();
    const { brief, claimsId, brandId } = await sendForApproval(w);
    const first = await (
      await loginAgent(app, w.owner)
    )
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(200);
    expect(first.body).toMatchObject({ postsCreated: 0, brief: { stage: 'reviewed' } });
    expect(publishMock.createDraftPostsForBrief).not.toHaveBeenCalled();

    const second = await (
      await loginAgent(app, w.brand)
    )
      .post(`${API}/approvals/${brandId}/decide`)
      .send({ decision: 'approved', note: 'On brand' })
      .expect(200);
    expect(second.body).toMatchObject({ postsCreated: 2, brief: { stage: 'approved' } });
    expect(second.body.approval).toMatchObject({ decision: 'approved', note: 'On brand' });
    expect(publishMock.createDraftPostsForBrief).toHaveBeenCalledTimes(1);
    const call = publishMock.createDraftPostsForBrief.mock.calls[0]!;
    expect(call[0]).toBe(brief.id);
    expect(call[1]).toBe(w.brand.id);
    expect(call[2]).toBeDefined();

    const again = await (
      await loginAgent(app, w.brand)
    )
      .post(`${API}/approvals/${brandId}/decide`)
      .send({ decision: 'approved' })
      .expect(409);
    expect(again.body.code).toBe('ALREADY_DECIDED');

    const log = await db.select().from(auditLogs).where(eq(auditLogs.action, 'approval.decide'));
    expect(log).toHaveLength(2);
    const ownerNotes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.maker.id), eq(notifications.kind, 'approval_decided')));
    expect(ownerNotes).toHaveLength(2);
  });

  it('rolls back the decision when draft posts cannot be created', async () => {
    publishMock.createDraftPostsForBrief.mockRejectedValue(
      notImplemented('createDraftPostsForBrief'),
    );
    const w = await makeWorld();
    const { brief, claimsId, brandId } = await sendForApproval(w);
    await (
      await loginAgent(app, w.owner)
    )
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(200);
    await (
      await loginAgent(app, w.brand)
    )
      .post(`${API}/approvals/${brandId}/decide`)
      .send({ decision: 'approved' })
      .expect(501);
    const [b] = await db.select().from(briefs).where(eq(briefs.id, brief.id));
    expect(b!.stage).toBe('reviewed');
    const [brand] = await db.select().from(approvals).where(eq(approvals.id, brandId));
    expect(brand!.decision).toBe('pending');
  });

  it('request changes needs a note, sends the brief back and makes the other gate stale', async () => {
    const w = await makeWorld();
    const { brief, claimsId, brandId } = await sendForApproval(w);
    const owner = await loginAgent(app, w.owner);
    const noNote = await owner
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'changes_requested' })
      .expect(400);
    expect(noNote.body.errors[0].path).toBe('body.note');
    const res = await owner
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'changes_requested', note: 'Spec 006 says 60 s, not 90 s' })
      .expect(200);
    expect(res.body.brief).toMatchObject({ stage: 'brief', version: 2 });
    const stale = await (
      await loginAgent(app, w.brand)
    )
      .post(`${API}/approvals/${brandId}/decide`)
      .send({ decision: 'approved' })
      .expect(409);
    expect(stale.body.code).toBe('APPROVAL_STALE');
    const pending = await (
      await loginAgent(app, w.brand)
    )
      .get(`${API}/approvals`)
      .query({ decision: 'pending' })
      .expect(200);
    expect(pending.body.total).toBe(0);
    const [b] = await db.select().from(briefs).where(eq(briefs.id, brief.id));
    expect(b!.frozenAt).toBeNull();
  });
});

describe('escalation job', () => {
  it('escalates past-due approvals once, then the backup can decide', async () => {
    const w = await makeWorld();
    const { claimsId } = await sendForApproval(w);
    const later = new Date(Date.now() + 49 * HOUR);
    expect(await escalateDueApprovals(new Date())).toEqual({ escalated: 0, waiting: 0 });
    expect(await escalateDueApprovals(later)).toEqual({ escalated: 2, waiting: 0 });
    expect(await escalateDueApprovals(later)).toEqual({ escalated: 0, waiting: 0 });

    const notes = await db
      .select()
      .from(notifications)
      .where(eq(notifications.kind, 'approval_escalated'));
    expect(notes.map((n) => n.userId).sort()).toEqual([w.backup.id, w.brandBackup.id].sort());

    const backup = await loginAgent(app, w.backup);
    const mine = await backup
      .get(`${API}/approvals`)
      .query({ decision: 'pending', mine: 'true', limit: 1 })
      .expect(200);
    expect(mine.body.total).toBe(1);
    const res = await backup
      .post(`${API}/approvals/${claimsId}/decide`)
      .send({ decision: 'approved' })
      .expect(200);
    expect(res.body.approval.decidedBy.id).toBe(w.backup.id);
    const [row] = await db.select().from(approvals).where(eq(approvals.id, claimsId));
    expect(row!.decision).toBe('approved');
  });

  it('waits when there is no backup, and never approves', async () => {
    const w = await makeWorld({ backup: false });
    const { claimsId } = await sendForApproval(w);
    const r = await escalateDueApprovals(new Date(Date.now() + 49 * HOUR));
    expect(r).toEqual({ escalated: 1, waiting: 1 });
    const [claims] = await db.select().from(approvals).where(eq(approvals.id, claimsId));
    expect(claims).toMatchObject({ decision: 'pending', escalatedAt: null });
  });

  it('skips stale approvals', async () => {
    const w = await makeWorld();
    const { brief, maker } = await sendForApproval(w);
    await maker
      .post(`${API}/briefs/${brief.id}/send-back`)
      .send({ version: 1, note: 'Redo' })
      .expect(200);
    expect(await escalateDueApprovals(new Date(Date.now() + 49 * HOUR))).toEqual({
      escalated: 0,
      waiting: 0,
    });
  });
});
