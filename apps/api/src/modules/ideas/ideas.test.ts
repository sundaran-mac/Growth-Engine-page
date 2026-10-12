import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ideaBoardInfoSchema, ideaGenerateResponseSchema, ideaSchema, listResponseSchema } from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { auditLogs, claudeUsage, ideas, productKits, productSettings, weeklyRuns } from '../../db/schema/index.js';
import { setClaudeClientForTests } from '../../lib/claude.js';
import { monthKey, weekStartKey } from '../../lib/time.js';
import { addMember, createTestProduct, createTestUser, loginAgent, truncateAll, type TestUser } from '../../../test/helpers.js';
import { createBriefFromIdea } from '../make/shared.js';
import { buildProductContext } from '../settings/shared.js';
import { generateIdeas, reviewIdeas } from './shared.js';
import { fakeClaude, fakeCreateBriefFromIdea } from './test-support.js';
import type * as MakeShared from '../make/shared.js';
import type * as SettingsShared from '../settings/shared.js';

const EM_DASH = String.fromCharCode(0x2014);

vi.mock('../settings/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsShared>()),
  buildProductContext: vi.fn(),
}));
vi.mock('../make/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof MakeShared>()),
  createBriefFromIdea: vi.fn(),
}));

const app = createApp();
const ideaList = listResponseSchema(ideaSchema);

interface World {
  productId: string;
  otherProductId: string;
  maker: TestUser;
  editor: TestUser;
  viewer: TestUser;
  outsider: TestUser;
}

async function world(): Promise<World> {
  const product = await createTestProduct({ name: 'Humini Live' });
  const other = await createTestProduct({ name: 'Humini Pulse' });
  const maker = await createTestUser({ role: 'member', name: 'Maya Maker' });
  const editor = await createTestUser({ role: 'editor', name: 'Jeeva Santiago' });
  const viewer = await createTestUser({ role: 'viewer' });
  const outsider = await createTestUser({ role: 'member' });
  await addMember(product.id, maker.id, 'maker');
  await addMember(other.id, outsider.id, 'maker');
  return { productId: product.id, otherProductId: other.id, maker, editor, viewer, outsider };
}

async function insertIdea(productId: string, over: Partial<typeof ideas.$inferInsert> = {}) {
  const [row] = await db
    .insert(ideas)
    .values({ productId, title: 'Their clock, not yours', mode: 'M3', channels: ['instagram'], fitScore: 80, source: 'claude', ...over })
    .returning();
  return row!;
}

beforeEach(async () => {
  await truncateAll();
  vi.mocked(buildProductContext).mockResolvedValue({ text: 'Promise: stay close to family.', tokenEstimate: 10, documentIds: [] });
  vi.mocked(createBriefFromIdea).mockImplementation(fakeCreateBriefFromIdea);
});

afterEach(() => {
  setClaudeClientForTests(null);
});

describe('GET /ideas', () => {
  it('lists a product board for a member, best fit first', async () => {
    const w = await world();
    await insertIdea(w.productId, { title: 'Low', fitScore: 10 });
    await insertIdea(w.productId, { title: 'High', fitScore: 95, status: 'starred' });
    await insertIdea(w.otherProductId, { title: 'Other product' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.get('/api/v1/ideas').query({ productId: w.productId }).expect(200);
    const body = ideaList.parse(res.body);
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.title)).toEqual(['High', 'Low']);

    const starred = await agent.get('/api/v1/ideas').query({ productId: w.productId, status: 'starred' }).expect(200);
    expect(starred.body.total).toBe(1);
  });

  it('shows the brief code on briefed ideas', async () => {
    const w = await world();
    const idea = await insertIdea(w.productId, { status: 'starred' });
    await fakeCreateBriefFromIdea({ ideaId: idea.id, actorId: w.editor.id });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.get('/api/v1/ideas').query({ productId: w.productId }).expect(200);
    expect(res.body.items[0]).toMatchObject({ status: 'briefed', briefCode: expect.stringMatching(/^REEL-\d{3}$/) });
  });

  it('refuses people outside the product, bad input and anonymous calls', async () => {
    const w = await world();
    const outsider = await loginAgent(app, w.outsider);
    const denied = await outsider.get('/api/v1/ideas').query({ productId: w.productId }).expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    const bad = await outsider.get('/api/v1/ideas').query({ productId: 'nope' }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    await request(app).get('/api/v1/ideas').query({ productId: w.productId }).expect(401);
  });
});

describe('POST /ideas and changes', () => {
  it('creates an idea by hand with an audit log', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const res = await agent
      .post('/api/v1/ideas')
      .send({ productId: w.productId, title: '  Grandma’s blessing ', mode: 'M2', channels: ['facebook', 'facebook'] })
      .expect(201);
    const idea = ideaSchema.parse(res.body);
    expect(idea).toMatchObject({ title: 'Grandma’s blessing', status: 'new', source: 'human', channels: ['facebook'] });
    expect(idea.createdBy?.name).toBe('Maya Maker');
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'idea.create'));
    expect(audit).toHaveLength(1);
  });

  it('validates the body and checks the role', async () => {
    const w = await world();
    const maker = await loginAgent(app, w.maker);
    const bad = await maker.post('/api/v1/ideas').send({ productId: w.productId, title: '', mode: 'M9' }).expect(400);
    expect(bad.body.errors.map((e: { path: string }) => e.path).sort()).toEqual(['body.mode', 'body.title']);
    const viewer = await loginAgent(app, w.viewer);
    await viewer.post('/api/v1/ideas').send({ productId: w.productId, title: 'x', mode: 'M1' }).expect(403);
  });

  it('stars, unstars, parks with a reason and unparks', async () => {
    const w = await world();
    const idea = await insertIdea(w.productId);
    const agent = await loginAgent(app, w.maker);
    const base = `/api/v1/ideas/${idea.id}`;
    expect((await agent.post(`${base}/star`).send({}).expect(200)).body.status).toBe('starred');
    expect((await agent.post(`${base}/star`).send({ starred: false }).expect(200)).body.status).toBe('new');
    const noReason = await agent.post(`${base}/park`).send({}).expect(400);
    expect(noReason.body.errors[0].path).toBe('body.reason');
    const parked = await agent.post(`${base}/park`).send({ reason: 'Needs a new cast' }).expect(200);
    expect(parked.body).toMatchObject({ status: 'parked', note: 'Needs a new cast' });
    const cannotStar = await agent.post(`${base}/star`).send({}).expect(409);
    expect(cannotStar.body.code).toBe('IDEA_STATUS_NOT_ALLOWED');
    const back = await agent.post(`${base}/unpark`).expect(200);
    expect(back.body).toMatchObject({ status: 'new', note: null });
    await agent.post(`${base}/unpark`).expect(409);
    const actions = (await db.select({ a: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, idea.id))).map((r) => r.a);
    expect(actions.sort()).toEqual(['idea.park', 'idea.star', 'idea.unpark', 'idea.unstar']);
  });

  it('edits an idea but not one that is already a brief', async () => {
    const w = await world();
    const idea = await insertIdea(w.productId);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.patch(`/api/v1/ideas/${idea.id}`).send({ title: 'Their clock', fitScore: 70 }).expect(200);
    expect(res.body).toMatchObject({ title: 'Their clock', fitScore: 70 });
    await agent.patch(`/api/v1/ideas/${idea.id}`).send({}).expect(400);
    await db.update(ideas).set({ status: 'briefed' }).where(eq(ideas.id, idea.id));
    const locked = await agent.patch(`/api/v1/ideas/${idea.id}`).send({ title: 'x' }).expect(409);
    expect(locked.body.code).toBe('IDEA_STATUS_NOT_ALLOWED');
    const outsider = await loginAgent(app, w.outsider);
    await outsider.patch(`/api/v1/ideas/${idea.id}`).send({ title: 'x' }).expect(403);
  });

  it('deletes for editors only, keeps briefed ideas, 404 for unknown ids', async () => {
    const w = await world();
    const idea = await insertIdea(w.productId);
    const maker = await loginAgent(app, w.maker);
    await maker.delete(`/api/v1/ideas/${idea.id}`).expect(403);
    const editor = await loginAgent(app, w.editor);
    await editor.delete(`/api/v1/ideas/${idea.id}`).expect(204);
    // Soft delete: the row stays (the content memory keeps its title), the board drops it.
    const [gone] = await db.select().from(ideas).where(eq(ideas.id, idea.id));
    expect(gone?.deletedAt).toBeInstanceOf(Date);
    const list = await editor.get('/api/v1/ideas').query({ productId: w.productId }).expect(200);
    expect(list.body.total).toBe(0);
    await editor.delete(`/api/v1/ideas/${idea.id}`).expect(404);
    const briefed = await insertIdea(w.productId, { status: 'briefed' });
    await editor.delete(`/api/v1/ideas/${briefed.id}`).expect(409);
    await editor.delete('/api/v1/ideas/not-a-uuid').expect(400);
  });

  it('opens a starred idea as a brief through MAKE', async () => {
    const w = await world();
    const idea = await insertIdea(w.productId, { status: 'starred' });
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post(`/api/v1/ideas/${idea.id}/brief`).expect(201);
    expect(res.body.brief).toMatchObject({ ideaId: idea.id, title: idea.title });
    expect(vi.mocked(createBriefFromIdea)).toHaveBeenCalledWith({ ideaId: idea.id, actorId: w.maker.id });
    const again = await agent.post(`/api/v1/ideas/${idea.id}/brief`).expect(409);
    expect(again.body.code).toBe('IDEA_STATUS_NOT_ALLOWED');
    const parked = await insertIdea(w.productId, { status: 'parked', note: 'later' });
    await agent.post(`/api/v1/ideas/${parked.id}/brief`).expect(409);
  });
});

describe('POST /ideas/generate', () => {
  const answer = {
    ideas: [
      { title: 'Elan reads your group chat', mode: 'M1', channels: ['instagram', 'linkedin'], fitScore: 86.4, why: 'Founder films led value last week.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' },
      { title: 'A 60 second call with grandma', mode: 'M1', channels: ['instagram'], fitScore: 90, why: 'Short and warm.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' },
      { title: 'Their clock, NOT yours', mode: 'M1', channels: ['instagram'], fitScore: 70, why: 'Duplicate.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' },
      { title: 'Rating the family group', mode: 'M5', channels: ['instagram'], fitScore: 78, why: 'Wrong mode for this request.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' },
      { title: `Ask Elan ${EM_DASH} the decisions`, mode: 'M1', channels: ['youtube'], fitScore: 140, why: 'Questions from the community.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' },
    ],
  };

  it('says Claude is not connected when there is no key', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post('/api/v1/ideas/generate').send({ productId: w.productId, count: 3 }).expect(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('FEATURE_DISABLED');
    expect(await db.select().from(ideas)).toHaveLength(0);
  });

  it('stores Claude ideas that pass the lint and drops the rest', async () => {
    const w = await world();
    await db.insert(productKits).values({ productId: w.productId, neverSay: ['60-second call'], notBuilt: [] });
    await insertIdea(w.productId, { title: 'Their clock, not yours' });
    const fake = fakeClaude(answer);
    setClaudeClientForTests(fake.client);
    const agent = await loginAgent(app, w.maker);

    const res = await agent
      .post('/api/v1/ideas/generate')
      .send({ productId: w.productId, mode: 'M1', channels: ['instagram', 'youtube'], count: 2 })
      .expect(201);
    const body = ideaGenerateResponseSchema.parse(res.body);
    // Best fit first.
    expect(body.items.map((i) => i.title)).toEqual(['Ask Elan, the decisions', 'Elan reads your group chat']);
    expect(body.dropped).toBe(3);
    // "Their clock, NOT yours" repeats an idea that is already on the board.
    expect(body.droppedAsDuplicate).toBe(1);
    expect(body.rounds).toBe(1);
    expect(body.items[0]!.angle).toBe('Parents abroad / Calls at their time / founder answers');
    expect(body.items[1]).toMatchObject({ source: 'claude', status: 'new', fitScore: 86, channels: ['instagram'], summary: 'Founder films led value last week.' });
    expect(body.items[0]!.fitScore).toBe(100);

    const prompt = fake.calls[0]!.prompt;
    expect(prompt).toContain('Promise: stay close to family.');
    expect(prompt).toContain('60-second call');
    expect(prompt).toContain('Their clock, not yours');
    expect(vi.mocked(buildProductContext)).toHaveBeenCalledWith(w.productId, { maxTokens: expect.any(Number) });

    const [usage] = await db.select().from(claudeUsage).where(eq(claudeUsage.productId, w.productId));
    expect(usage).toMatchObject({ inputTokens: 120, outputTokens: 80, requestCount: 1 });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'idea.generate'));
    expect(audit[0]?.after).toMatchObject({ source: 'manual', created: 2, dropped: 3 });
  });

  it('refuses when the monthly Claude budget is used up', async () => {
    const w = await world();
    // The product's own cap from Settings is the one enforced (not the env cap).
    await db.insert(productSettings).values({ productId: w.productId, claudeMonthlyTokenCap: 100 });
    await db.insert(claudeUsage).values({ productId: w.productId, month: monthKey(new Date()), inputTokens: 100, outputTokens: 0, capTokens: 100 });
    setClaudeClientForTests(fakeClaude(answer).client);
    const agent = await loginAgent(app, w.maker);
    const res = await agent.post('/api/v1/ideas/generate').send({ productId: w.productId }).expect(429);
    expect(res.body.code).toBe('CLAUDE_CAP_REACHED');
  });

  it('validates count and checks the role', async () => {
    const w = await world();
    setClaudeClientForTests(fakeClaude(answer).client);
    const maker = await loginAgent(app, w.maker);
    const bad = await maker.post('/api/v1/ideas/generate').send({ productId: w.productId, count: 21 }).expect(400);
    expect(bad.body.errors[0].path).toBe('body.count');
    const viewer = await loginAgent(app, w.viewer);
    await viewer.post('/api/v1/ideas/generate').send({ productId: w.productId, count: 2 }).expect(403);
  });
});

describe('GET /ideas/board', () => {
  it('reports Claude status, usage and this week’s weekly proposal', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const empty = ideaBoardInfoSchema.parse((await agent.get('/api/v1/ideas/board').query({ productId: w.productId }).expect(200)).body);
    expect(empty).toMatchObject({ claude: { enabled: false, usedTokens: 0 }, weeklyProposal: null });

    await db.insert(weeklyRuns).values({
      productId: w.productId,
      weekStart: weekStartKey(new Date()),
      status: 'done',
      ideasCreated: 6,
      githubPrUrl: 'https://github.com/humini-ecosystem/humini-live/pull/42',
      triggeredBy: 'schedule',
      finishedAt: new Date(),
    });
    const body = ideaBoardInfoSchema.parse((await agent.get('/api/v1/ideas/board').query({ productId: w.productId }).expect(200)).body);
    expect(body.weeklyProposal).toMatchObject({ ideasCreated: 6, githubPrUrl: 'https://github.com/humini-ecosystem/humini-live/pull/42' });

    const outsider = await loginAgent(app, w.outsider);
    await outsider.get('/api/v1/ideas/board').query({ productId: w.productId }).expect(403);
  });
});

describe('shared functions used by the weekly run', () => {
  it('generateIdeas stores weekly ideas with no actor', async () => {
    const w = await world();
    setClaudeClientForTests(fakeClaude({ ideas: [{ title: 'Meet the builder', mode: 'M6', channels: ['linkedin'], fitScore: 70, why: 'Inside Arus works.', audience: 'Parents abroad', behaviour: 'Calls at their time', angle: 'founder answers' }] }).client);
    const created = await generateIdeas(w.productId, { count: 5, source: 'weekly', weeklyRunId: '7d3c4f2e-0000-4000-8000-000000000001' }, null);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ createdBy: null, source: 'claude' });
    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'idea.generate'));
    expect(audit?.after).toMatchObject({ source: 'weekly', weeklyRunId: '7d3c4f2e-0000-4000-8000-000000000001' });
  });

  it('reviewIdeas re-scores with Claude and flags stale ideas without touching people’s notes', async () => {
    const w = await world();
    await db.insert(productKits).values({ productId: w.productId, neverSay: ['influencer'], notBuilt: [] });
    const fresh = await insertIdea(w.productId, { title: 'Fresh', fitScore: 50 });
    const old = await insertIdea(w.productId, { title: 'Old one', fitScore: 60, createdAt: new Date(Date.now() - 40 * 86_400_000) });
    const banned = await insertIdea(w.productId, { title: 'The influencer who could not', status: 'starred', fitScore: 70 });
    const human = await insertIdea(w.productId, { title: 'Kept note', note: 'Shoot on Friday', fitScore: 40 });
    const parked = await insertIdea(w.productId, { title: 'Parked', status: 'parked', note: 'later' });
    setClaudeClientForTests(
      fakeClaude({
        reviews: [
          { id: fresh.id, fitScore: 72, stale: false, reason: 'Fits' },
          { id: human.id, fitScore: 40, stale: true, reason: 'Moment passed' },
          { id: 'not-ours', fitScore: 1, stale: true, reason: 'ignored' },
        ],
      }).client,
    );

    const result = await reviewIdeas(w.productId);
    expect(result).toEqual({ rescored: 1, flaggedStale: 3 });
    const rows = new Map((await db.select().from(ideas).where(eq(ideas.productId, w.productId))).map((r) => [r.id, r]));
    expect(rows.get(fresh.id)).toMatchObject({ fitScore: 72, note: null });
    expect(rows.get(old.id)?.note).toBe('Stale: still new after 28 days');
    expect(rows.get(banned.id)?.note).toMatch(/^Stale: uses "influencer"/);
    expect(rows.get(human.id)?.note).toBe('Shoot on Friday');
    expect(rows.get(parked.id)?.note).toBe('later');
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'idea.review'), eq(auditLogs.entityId, w.productId)));
    expect(audit).toHaveLength(1);
  });

  it('reviewIdeas still applies the lint rules when Claude is off', async () => {
    const w = await world();
    await db.insert(productKits).values({ productId: w.productId, neverSay: ['influencer'], notBuilt: [] });
    await insertIdea(w.productId, { title: 'The influencer who could not' });
    expect(await reviewIdeas(w.productId)).toEqual({ rescored: 0, flaggedStale: 1 });
  });
});
