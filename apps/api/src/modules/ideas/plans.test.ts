import request from 'supertest';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listResponseSchema, occasionSchema, planChecksSchema, planFreezeResponseSchema, planGetResponseSchema, planItemViewSchema, planViewSchema } from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { auditLogs, briefs, ideas, occasionProducts, occasions, planItems, plans, productKits, products } from '../../db/schema/index.js';
import { addMember, createTestProduct, createTestUser, loginAgent, truncateAll, type TestUser } from '../../../test/helpers.js';
import { createBriefFromIdea } from '../make/shared.js';
import { fakeCreateBriefFromIdea } from './test-support.js';
import type * as MakeShared from '../make/shared.js';

vi.mock('../make/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof MakeShared>()),
  createBriefFromIdea: vi.fn(),
}));

const app = createApp();

interface World {
  productId: string;
  otherProductId: string;
  owner: TestUser;
  maker: TestUser;
  reviewer: TestUser;
  editor: TestUser;
  admin: TestUser;
}

async function world(): Promise<World> {
  const product = await createTestProduct({ name: 'Humini Live' });
  const other = await createTestProduct({ name: 'Humini Pulse' });
  const owner = await createTestUser({ role: 'member', name: 'Live Owner' });
  const maker = await createTestUser({ role: 'member' });
  const reviewer = await createTestUser({ role: 'member' });
  const editor = await createTestUser({ role: 'editor', name: 'Jeeva Santiago' });
  const admin = await createTestUser({ role: 'admin' });
  await addMember(product.id, owner.id, 'owner');
  await addMember(product.id, maker.id, 'maker');
  await addMember(product.id, reviewer.id, 'reviewer');
  return { productId: product.id, otherProductId: other.id, owner, maker, reviewer, editor, admin };
}

async function insertPlan(productId: string, month = '2026-11') {
  const [row] = await db.insert(plans).values({ productId, month }).returning();
  return row!;
}

async function insertIdea(productId: string, over: Partial<typeof ideas.$inferInsert> = {}) {
  const [row] = await db
    .insert(ideas)
    .values({ productId, title: 'Their clock, not yours', mode: 'M3', channels: ['youtube', 'instagram'], status: 'starred', ...over })
    .returning();
  return row!;
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(createBriefFromIdea).mockReset();
  vi.mocked(createBriefFromIdea).mockImplementation(fakeCreateBriefFromIdea);
});

describe('plans', () => {
  it('returns null for a month with no plan, then starts it once', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const none = planGetResponseSchema.parse((await agent.get('/api/v1/plans').query({ productId: w.productId, month: '2026-11' }).expect(200)).body);
    expect(none.plan).toBeNull();

    const created = planViewSchema.parse((await agent.post('/api/v1/plans').send({ productId: w.productId, month: '2026-11' }).expect(201)).body);
    expect(created).toMatchObject({ status: 'draft', month: '2026-11', items: [] });
    const dup = await agent.post('/api/v1/plans').send({ productId: w.productId, month: '2026-11' }).expect(409);
    expect(dup.body.code).toBe('PLAN_EXISTS');

    const got = planGetResponseSchema.parse((await agent.get('/api/v1/plans').query({ productId: w.productId, month: '2026-11' }).expect(200)).body);
    expect(got.plan?.id).toBe(created.id);
  });

  it('validates the month and checks roles', async () => {
    const w = await world();
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.get('/api/v1/plans').query({ productId: w.productId, month: '2026-13' }).expect(400);
    await reviewer.get('/api/v1/plans').query({ productId: w.productId, month: '2026-11' }).expect(200);
    await reviewer.post('/api/v1/plans').send({ productId: w.productId, month: '2026-11' }).expect(403);
    await request(app).get('/api/v1/plans').query({ productId: w.productId, month: '2026-11' }).expect(401);
  });

  it('adds a piece from a starred idea, using its title, mode and first channel', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const idea = await insertIdea(w.productId);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-18', ideaId: idea.id }).expect(201);
    const item = planItemViewSchema.parse(res.body);
    expect(item).toMatchObject({ title: idea.title, mode: 'M3', channel: 'youtube', ideaId: idea.id, briefId: null, position: 0 });
    const second = await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-18', title: 'Q#14 poll', mode: 'M4', channel: 'instagram' }).expect(201);
    expect(second.body.position).toBe(1);
  });

  it('refuses days outside the month, missing titles and ideas it cannot use', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const agent = await loginAgent(app, w.maker);
    const outside = await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-12-01', title: 'x' }).expect(400);
    expect(outside.body.errors[0].path).toBe('body.date');
    const noTitle = await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-02' }).expect(400);
    expect(noTitle.body.errors[0].path).toBe('body.title');
    const otherIdea = await insertIdea(w.otherProductId);
    const wrong = await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-02', ideaId: otherIdea.id }).expect(422);
    expect(wrong.body.code).toBe('IDEA_NOT_USABLE');
    const parked = await insertIdea(w.productId, { status: 'parked' });
    await agent.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-02', ideaId: parked.id }).expect(422);
    const reviewer = await loginAgent(app, w.reviewer);
    await reviewer.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-02', title: 'x' }).expect(403);
  });

  it('moves a piece to another day (drag and drop) and removes it', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const [item] = await db.insert(planItems).values({ planId: plan.id, date: '2026-11-02', title: 'Why I build', mode: 'M1' }).returning();
    const agent = await loginAgent(app, w.maker);
    const moved = await agent.patch(`/api/v1/plan-items/${item!.id}`).send({ date: '2026-11-05', needsShootSlot: true }).expect(200);
    expect(moved.body).toMatchObject({ date: '2026-11-05', needsShootSlot: true });
    await agent.patch(`/api/v1/plan-items/${item!.id}`).send({ date: '2026-10-31' }).expect(400);
    await agent.patch(`/api/v1/plan-items/${item!.id}`).send({}).expect(400);
    await agent.delete(`/api/v1/plan-items/${item!.id}`).expect(204);
    await agent.delete(`/api/v1/plan-items/${item!.id}`).expect(404);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, item!.id))).map((r) => r.a);
    expect(actions.sort()).toEqual(['plan_item.delete', 'plan_item.update']);
  });

  it('computes the mix, the occasions and the things to fix on the server', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    await db.insert(planItems).values([
      { planId: plan.id, date: '2026-11-02', title: 'Why I build', mode: 'M1' },
      { planId: plan.id, date: '2026-11-13', title: 'Ask Elan', mode: 'M1', needsShootSlot: true },
      { planId: plan.id, date: '2026-11-20', title: 'Decisions', mode: 'M1', needsShootSlot: true },
      { planId: plan.id, date: '2026-11-04', title: 'Two hearts', mode: 'M3' },
      { planId: plan.id, date: '2026-11-30', title: 'O8 poster', mode: 'M4' },
      { planId: plan.id, date: '2026-11-30', title: 'Month end', mode: 'M5' },
    ]);
    const [deepavali] = await db.insert(occasions).values({ name: 'Deepavali', date: '2026-11-08', endDate: '2026-11-11' }).returning();
    await db.insert(occasionProducts).values({ occasionId: deepavali!.id, productId: w.productId });
    const [pulseOnly] = await db.insert(occasions).values({ name: 'Pulse day', date: '2026-11-10' }).returning();
    await db.insert(occasionProducts).values({ occasionId: pulseOnly!.id, productId: w.otherProductId });
    await db.insert(occasions).values({ name: 'Children’s Day', date: '2026-11-14' });

    const agent = await loginAgent(app, w.reviewer);
    const checks = planChecksSchema.parse((await agent.get(`/api/v1/plans/${plan.id}/checks`).expect(200)).body);
    expect(checks.total).toBe(6);
    expect(checks.mix.slice(0, 2)).toEqual([
      { mode: 'M1', count: 3 },
      { mode: 'M3', count: 1 },
    ]);
    expect(checks.occasions.map((o) => o.name)).toEqual(['Deepavali', 'Children’s Day']);
    expect(checks.warnings.map((x) => x.message)).toEqual(['2 founder films have no shoot slot', 'No Humini Live piece in week 5']);
  });

  it('adds the cross-product check for other products with a signed kit', async () => {
    const w = await world();
    await db.update(products).set({ shortName: 'Pulse' }).where(eq(products.id, w.otherProductId));
    const send = await createTestProduct({ name: 'Humini Send' });
    await db.update(products).set({ shortName: 'Send' }).where(eq(products.id, send.id));
    const draftKit = await createTestProduct({ name: 'Draft kit' });
    const resigned = await createTestProduct({ name: 'Edited after signing' });
    const archived = await createTestProduct({ name: 'Old' });
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, archived.id));
    const signedAt = new Date('2026-10-01T00:00:00Z');
    await db.insert(productKits).values([
      { productId: w.otherProductId, version: 1, signedById: w.owner.id, signedAt },
      { productId: send.id, version: 1, signedById: w.owner.id, signedAt },
      { productId: draftKit.id, version: 1 },
      { productId: resigned.id, version: 1, signedById: w.owner.id, signedAt },
      { productId: resigned.id, version: 2 },
      { productId: archived.id, version: 1, signedById: w.owner.id, signedAt },
      // The plan's own product: covered by EMPTY_WEEK, never doubled.
      { productId: w.productId, version: 1, signedById: w.owner.id, signedAt },
    ]);
    const plan = await insertPlan(w.productId);
    await db.insert(planItems).values(
      ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'].map((date) => ({ planId: plan.id, date, title: 'Live piece', mode: 'M3' as const })),
    );
    const pulsePlan = await insertPlan(w.otherProductId);
    await db.insert(planItems).values(
      ['2026-11-03', '2026-11-18', '2026-11-26'].map((date) => ({ planId: pulsePlan.id, date, title: 'Pulse piece', mode: 'M2' as const })),
    );
    // A Pulse item in another month does not count.
    const pulseDec = await insertPlan(w.otherProductId, '2026-12');
    await db.insert(planItems).values({ planId: pulseDec.id, date: '2026-12-10', title: 'Later', mode: 'M2' });

    const agent = await loginAgent(app, w.reviewer);
    const checks = planChecksSchema.parse((await agent.get(`/api/v1/plans/${plan.id}/checks`).expect(200)).body);
    expect(checks.warnings).toEqual([
      { code: 'PRODUCT_EMPTY_WEEK', message: 'No Pulse piece in week 3', itemIds: [], week: 3, productId: w.otherProductId },
      { code: 'PRODUCT_EMPTY_WEEK', message: 'No Send piece planned in November', itemIds: [], week: null, productId: send.id },
    ]);
  });

  it('freezes: owner only (or editor), briefs for idea items, then locks edits', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const idea = await insertIdea(w.productId);
    const briefedIdea = await insertIdea(w.productId, { title: '60 seconds with Elan', mode: 'M1' });
    const existing = await fakeCreateBriefFromIdea({ ideaId: briefedIdea.id, actorId: w.editor.id });
    vi.mocked(createBriefFromIdea).mockClear();
    const [a, b, c] = await db
      .insert(planItems)
      .values([
        { planId: plan.id, date: '2026-11-18', title: 'Their clock', mode: 'M3', ideaId: idea.id },
        { planId: plan.id, date: '2026-11-06', title: '60s with Elan', mode: 'M1', ideaId: briefedIdea.id },
        { planId: plan.id, date: '2026-11-08', title: 'Deepavali circle', mode: null, channel: 'whatsapp' },
      ])
      .returning();

    const maker = await loginAgent(app, w.maker);
    await maker.post(`/api/v1/plans/${plan.id}/freeze`).expect(403);

    const owner = await loginAgent(app, w.owner);
    const res = await owner.post(`/api/v1/plans/${plan.id}/freeze`).expect(200);
    const body = planFreezeResponseSchema.parse(res.body);
    expect(body).toMatchObject({ briefsCreated: 1, itemsWithoutIdea: 1 });
    expect(body.plan.status).toBe('frozen');
    expect(body.plan.frozenBy?.name).toBe('Live Owner');
    expect(vi.mocked(createBriefFromIdea)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createBriefFromIdea).mock.calls[0]![0]).toEqual({ ideaId: idea.id, actorId: w.owner.id, planItemId: a!.id });
    const byId = new Map(body.plan.items.map((i) => [i.id, i]));
    expect(byId.get(a!.id)?.briefCode).toMatch(/^REEL-/);
    expect(byId.get(b!.id)?.briefId).toBe(existing.id);
    expect(byId.get(c!.id)?.briefId).toBeNull();

    const locked = await maker.patch(`/api/v1/plan-items/${a!.id}`).send({ date: '2026-11-19' }).expect(409);
    expect(locked.body.code).toBe('PLAN_FROZEN');
    await maker.post(`/api/v1/plans/${plan.id}/items`).send({ date: '2026-11-02', title: 'x' }).expect(409);
    await maker.delete(`/api/v1/plan-items/${a!.id}`).expect(409);
    const twice = await owner.post(`/api/v1/plans/${plan.id}/freeze`).expect(409);
    expect(twice.body.code).toBe('PLAN_FROZEN');
  });

  it('rolls the freeze back when a brief cannot be made', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const idea = await insertIdea(w.productId);
    await db.insert(planItems).values({ planId: plan.id, date: '2026-11-18', title: 'x', mode: 'M3', ideaId: idea.id });
    vi.mocked(createBriefFromIdea).mockRejectedValueOnce(new Error('boom'));
    const editor = await loginAgent(app, w.editor);
    await editor.post(`/api/v1/plans/${plan.id}/freeze`).expect(500);
    const [row] = await db.select().from(plans).where(eq(plans.id, plan.id));
    expect(row?.status).toBe('draft');
    expect(await db.select().from(briefs)).toHaveLength(0);
  });

  it('unfreezes for admins only, with an audit log', async () => {
    const w = await world();
    const plan = await insertPlan(w.productId);
    const editor = await loginAgent(app, w.editor);
    await editor.post(`/api/v1/plans/${plan.id}/freeze`).expect(200);
    await editor.post(`/api/v1/plans/${plan.id}/unfreeze`).expect(403);
    const admin = await loginAgent(app, w.admin);
    const res = await admin.post(`/api/v1/plans/${plan.id}/unfreeze`).expect(200);
    expect(res.body).toMatchObject({ status: 'draft', frozenAt: null, frozenBy: null });
    await admin.post(`/api/v1/plans/${plan.id}/unfreeze`).expect(409);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'plan.unfreeze'));
    expect(audit).toHaveLength(1);
    await admin.post('/api/v1/plans/00000000-0000-4000-8000-000000000000/unfreeze').expect(404);
  });
});

describe('occasions', () => {
  it('lists occasions in a range, filtered by product', async () => {
    const w = await world();
    const [live] = await db.insert(occasions).values({ name: 'Deepavali', date: '2026-11-08', endDate: '2026-11-11' }).returning();
    await db.insert(occasionProducts).values({ occasionId: live!.id, productId: w.productId });
    const [pulse] = await db.insert(occasions).values({ name: 'Pulse day', date: '2026-11-10' }).returning();
    await db.insert(occasionProducts).values({ occasionId: pulse!.id, productId: w.otherProductId });
    await db.insert(occasions).values({ name: 'Late', date: '2026-12-20' });

    const agent = await loginAgent(app, w.maker);
    const all = listResponseSchema(occasionSchema).parse((await agent.get('/api/v1/occasions').query({ from: '2026-11-10', to: '2026-11-30' }).expect(200)).body);
    expect(all.items.map((o) => o.name)).toEqual(['Deepavali', 'Pulse day']);
    const mine = await agent.get('/api/v1/occasions').query({ from: '2026-11-01', to: '2026-11-30', productId: w.productId }).expect(200);
    expect(mine.body.items.map((o: { name: string }) => o.name)).toEqual(['Deepavali']);
    await agent.get('/api/v1/occasions').query({ from: '2026-11-30', to: '2026-11-01' }).expect(400);
    await agent.get('/api/v1/occasions').query({ from: '2026-11-01', to: '2026-11-30', productId: w.otherProductId }).expect(403);
  });

  it('creates an occasion for editors, with products and an audit log', async () => {
    const w = await world();
    const editor = await loginAgent(app, w.editor);
    const res = await editor
      .post('/api/v1/occasions')
      .send({ name: 'Exam season starts', date: '2026-11-23', productIds: [w.productId] })
      .expect(201);
    expect(occasionSchema.parse(res.body)).toMatchObject({ name: 'Exam season starts', productIds: [w.productId], endDate: null });
    const bad = await editor.post('/api/v1/occasions').send({ name: 'x', date: '2026-11-23', endDate: '2026-11-20' }).expect(400);
    expect(bad.body.errors[0].path).toBe('body.endDate');
    const unknown = await editor
      .post('/api/v1/occasions')
      .send({ name: 'x', date: '2026-11-23', productIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(400);
    expect(unknown.body.errors[0].path).toBe('body.productIds');
    const maker = await loginAgent(app, w.maker);
    await maker.post('/api/v1/occasions').send({ name: 'x', date: '2026-11-23' }).expect(403);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'occasion.create'))).toHaveLength(1);
  });
});
