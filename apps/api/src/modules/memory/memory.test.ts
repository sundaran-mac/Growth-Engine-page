/**
 * Content memory end to end (BUILD-PLAN section 11): people, Claude, briefs, publishing,
 * the check and stats endpoints, and the backfill. Real Postgres; Claude is a fake client.
 */
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ideaGenerateResponseSchema,
  ideaSchema,
  memoryCheckResultSchema,
  memoryStatsSchema,
  problemDetailsSchema,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import { auditLogs, briefs, channelAccounts, contentMemory, ideas, posts } from '../../db/schema/index.js';
import { setClaudeClientForTests } from '../../lib/claude.js';
import { addMember, createTestProduct, createTestUser, loginAgent, truncateAll, type TestUser } from '../../../test/helpers.js';
import { fakeClaude } from '../ideas/test-support.js';
import { markPosted } from '../publish/service.js';
import { buildProductContext } from '../settings/shared.js';
import type * as SettingsShared from '../settings/shared.js';
import { backfillMemory } from './backfill.js';

vi.mock('../settings/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SettingsShared>()),
  buildProductContext: vi.fn(),
}));

const app = createApp();

interface World {
  liveId: string;
  pulseId: string;
  maker: TestUser;
  editor: TestUser;
  outsider: TestUser;
}

async function world(): Promise<World> {
  const live = await createTestProduct({ name: 'Humini Live' });
  const pulse = await createTestProduct({ name: 'Humini Pulse' });
  const maker = await createTestUser({ role: 'member' });
  const editor = await createTestUser({ role: 'editor' });
  const outsider = await createTestUser({ role: 'member' });
  await addMember(live.id, maker.id, 'maker');
  await addMember(pulse.id, maker.id, 'maker');
  await addMember(pulse.id, outsider.id, 'maker');
  return { liveId: live.id, pulseId: pulse.id, maker, editor, outsider };
}

const idea = (productId: string, title: string, extra: Record<string, unknown> = {}) => ({ productId, title, mode: 'M3', channels: ['instagram'], ...extra });

beforeEach(async () => {
  await truncateAll();
  vi.mocked(buildProductContext).mockResolvedValue({ text: 'Promise: stay close to family.', tokenEstimate: 10, documentIds: [] });
});

afterEach(() => setClaudeClientForTests(null));

describe('POST /ideas and PATCH /ideas/:id against the memory', () => {
  it('blocks a duplicate from any product, with the earlier idea in the problem', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const first = ideaSchema.parse((await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(201)).body);

    const res = await agent.post('/api/v1/ideas').send(idea(w.pulseId, 'Their Clock, NOT yours!')).expect(409);
    const problem = problemDetailsSchema.parse(res.body);
    expect(problem.code).toBe('IDEA_DUPLICATE');
    expect(problem.matches?.[0]).toMatchObject({ sourceType: 'idea', sourceId: first.id, productName: 'Humini Live', layer: 'fingerprint' });
    expect(problem.errors?.[0]?.path).toBe('body.title');
    // A reason never unlocks a duplicate.
    await agent.post('/api/v1/ideas').send(idea(w.pulseId, 'Their clock not yours', { similarReason: 'Different audience entirely' })).expect(409);
  });

  it('asks for a reason when similar, and stores the reason in the audit log', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Grandma learns to video call')).expect(201);

    const similar = await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Grandpa tries a video call')).expect(409);
    expect(similar.body.code).toBe('IDEA_SIMILAR');
    expect(similar.body.matches[0].title).toBe('Grandma learns to video call');

    await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Grandpa tries a video call', { similarReason: 'short' })).expect(400);
    const ok = await agent
      .post('/api/v1/ideas')
      .send(idea(w.liveId, 'Grandpa tries a video call', { similarReason: 'Grandpa is the hero, not the learner' }))
      .expect(201);
    const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'idea.create'), eq(auditLogs.entityId, ok.body.id as string)));
    expect(audit?.after).toMatchObject({ memory: { status: 'similar', similarReason: 'Grandpa is the hero, not the learner' } });
    expect(await db.select().from(contentMemory).where(eq(contentMemory.sourceType, 'idea'))).toHaveLength(2);
  });

  it('checks a changed title on PATCH, but not the idea against itself', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(201);
    const mine = (await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Rating the office playlist')).expect(201)).body as { id: string };

    const dup = await agent.patch(`/api/v1/ideas/${mine.id}`).send({ title: 'Their clock, not yours!' }).expect(409);
    expect(dup.body.code).toBe('IDEA_DUPLICATE');
    await agent.patch(`/api/v1/ideas/${mine.id}`).send({ title: 'Rating the office playlist!' }).expect(200);
    await agent.patch(`/api/v1/ideas/${mine.id}`).send({ similarReason: 'Only a reason here' }).expect(400);
    const [row] = await db.select().from(contentMemory).where(eq(contentMemory.sourceId, mine.id));
    expect(row?.title).toBe('Rating the office playlist!');
  });

  it('keeps a deleted idea in the memory, so its title stays used', async () => {
    const w = await world();
    const maker = await loginAgent(app, w.maker);
    const editor = await loginAgent(app, w.editor);
    const created = (await maker.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(201)).body as { id: string };
    await editor.delete(`/api/v1/ideas/${created.id}`).expect(204);
    expect(await db.select().from(ideas).where(and(eq(ideas.id, created.id), isNull(ideas.deletedAt)))).toHaveLength(0);
    await maker.patch(`/api/v1/ideas/${created.id}`).send({ title: 'New' }).expect(404);
    const again = await maker.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(409);
    expect(again.body.code).toBe('IDEA_DUPLICATE');
  });
});

describe('POST /ideas/generate keeps Claude ideas unique', () => {
  const draft = (title: string, fitScore: number) => ({
    title,
    mode: 'M3',
    channels: ['instagram'],
    fitScore,
    why: 'Fits the promise.',
    audience: 'Parents abroad',
    behaviour: 'Calls at their time',
    angle: title.split(' ').slice(0, 2).join(' '),
  });

  it('drops repeats of the memory and of the batch, retries for the missing number, and remembers drops', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    await agent.post('/api/v1/ideas').send(idea(w.pulseId, 'Their clock, not yours')).expect(201);
    const fake = fakeClaude({
      ideas: [draft('Grandma learns to video call', 90), draft('Their clock not yours!', 95), draft('Grandma learns video calls fast', 80)],
    });
    setClaudeClientForTests(fake.client);

    const res = await agent.post('/api/v1/ideas/generate').send({ productId: w.liveId, count: 2 }).expect(201);
    const body = ideaGenerateResponseSchema.parse(res.body);
    expect(body.items.map((i) => i.title)).toEqual(['Grandma learns to video call']);
    expect(body.items[0]!.angle).toBe('Parents abroad / Calls at their time / Grandma learns');
    expect(body.rounds).toBe(3);
    // Round 1: 2 repeats; rounds 2 and 3: all 3 drafts repeat.
    expect(body.droppedAsDuplicate).toBe(8);
    expect(body.dropped).toBe(8);

    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0]!.prompt).toContain('Draft exactly 3 new ideas');
    expect(fake.calls[0]!.prompt).toContain('<memory_coverage_all_products>');
    expect(fake.calls[0]!.prompt).toContain('Their clock, not yours (Humini Pulse)');
    expect(fake.calls[0]!.prompt).toContain('<unexplored_seed>');
    expect(fake.calls[1]!.prompt).toContain('Draft exactly 2 new ideas');
    expect(fake.calls[1]!.prompt).toContain('<rejected_in_this_run>');
    expect(fake.calls[1]!.prompt).toContain('Their clock not yours!');

    const drops = await db.select().from(contentMemory).where(eq(contentMemory.sourceType, 'dropped_draft'));
    expect(drops).toHaveLength(8);
    const [kept] = await db.select().from(contentMemory).where(eq(contentMemory.sourceId, body.items[0]!.id));
    expect(kept).toMatchObject({ sourceType: 'idea', angle: 'Parents abroad / Calls at their time / Grandma learns', mode: 'M3' });

    // The same answer next week makes nothing new.
    setClaudeClientForTests(fakeClaude({ ideas: [draft('Grandma learns to video call', 90)] }).client);
    const next = ideaGenerateResponseSchema.parse((await agent.post('/api/v1/ideas/generate').send({ productId: w.pulseId, count: 1 }).expect(201)).body);
    expect(next.items).toHaveLength(0);
    expect(next.droppedAsDuplicate).toBe(3);
  });
});

describe('briefs against the memory', () => {
  const brief = (productId: string, title: string, extra: Record<string, unknown> = {}) => ({ productId, title, mode: 'M1', ...extra });

  it('blocks a manual brief that repeats an idea, and asks a reason when similar', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(201);
    const dup = await agent.post('/api/v1/briefs').send(brief(w.pulseId, 'Their clock, not yours')).expect(409);
    expect(dup.body.code).toBe('IDEA_DUPLICATE');

    await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Grandma learns to video call')).expect(201);
    const similar = await agent.post('/api/v1/briefs').send(brief(w.liveId, 'Grandpa tries a video call')).expect(409);
    expect(similar.body.code).toBe('IDEA_SIMILAR');
    const ok = await agent
      .post('/api/v1/briefs')
      .send(brief(w.liveId, 'Grandpa tries a video call', { hook: 'Grandpa calls first, for once.', similarReason: 'Grandpa leads, a new angle' }))
      .expect(201);
    expect(ok.body.hook).toBe('Grandpa calls first, for once.');
    const [row] = await db.select().from(contentMemory).where(eq(contentMemory.sourceId, ok.body.id as string));
    expect(row).toMatchObject({ sourceType: 'brief_hook', body: 'Grandpa calls first, for once.' });
  });

  it('blocks a hook that duplicates another brief, warns only when similar, never against itself', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const hook = 'Mum calls at six every Sunday and the whole house stops to listen';
    const a = (await agent.post('/api/v1/briefs').send(brief(w.liveId, 'Sunday call', { hook })).expect(201)).body as { id: string };
    const b = (await agent.post('/api/v1/briefs').send(brief(w.pulseId, 'Office pulse check')).expect(201)).body as {
      id: string;
      version: number;
      updatedAt: string;
    };

    const res = await agent.patch(`/api/v1/briefs/${b.id}`).send({ version: b.version, updatedAt: b.updatedAt, hook }).expect(409);
    expect(res.body.code).toBe('IDEA_DUPLICATE');
    expect(res.body.matches[0]).toMatchObject({ sourceType: 'brief_hook', sourceId: a.id });

    const fresh = (await agent.get(`/api/v1/briefs/${a.id}`).expect(200)).body as { version: number; updatedAt: string };
    await agent.patch(`/api/v1/briefs/${a.id}`).send({ version: fresh.version, updatedAt: fresh.updatedAt, hook: `${hook}!` }).expect(200);
    const [row] = await db.select().from(contentMemory).where(eq(contentMemory.sourceId, a.id));
    expect(row?.body).toBe(`${hook}!`);
  });
});

describe('publishing remembers captions', () => {
  it('stores the caption of a post marked as posted', async () => {
    const w = await world();
    const [b] = await db.insert(briefs).values({ code: 'REEL-901', productId: w.liveId, title: 'Sunday call', mode: 'M1', stage: 'approved' }).returning();
    const [channel] = await db.insert(channelAccounts).values({ platform: 'whatsapp', displayName: 'WA', status: 'connected', allowedActions: ['publish'] }).returning();
    const [post] = await db
      .insert(posts)
      .values({ briefId: b!.id, briefVersion: 1, channelAccountId: channel!.id, caption: 'Call mum tonight. She is waiting.', status: 'manual_pending', scheduledAt: new Date() })
      .returning();
    await markPosted(post!.id, {}, { actorId: null, requestId: null, ip: null });
    const [row] = await db.select().from(contentMemory).where(eq(contentMemory.sourceId, post!.id));
    expect(row).toMatchObject({ sourceType: 'post_caption', productId: w.liveId, body: 'Call mum tonight. She is waiting.' });

    // Another brief with a near-identical caption is flagged; the same brief is not.
    const agent = await loginAgent(app, w.maker);
    const other = await agent
      .post('/api/v1/memory/check')
      .send({ productId: w.liveId, kind: 'post_caption', title: 'Other', body: 'Call mum tonight! She is waiting.' })
      .expect(200);
    expect(memoryCheckResultSchema.parse(other.body).status).toBe('duplicate');
    const same = await agent
      .post('/api/v1/memory/check')
      .send({ productId: w.liveId, kind: 'post_caption', title: 'Sunday call', body: 'Call mum tonight! She is waiting.', excludeBriefId: b!.id })
      .expect(200);
    expect(same.body.status).toBe('unique');
  });
});

describe('POST /memory/check and GET /memory/stats', () => {
  it('needs a session, a valid body and access to the product', async () => {
    const w = await world();
    await request(app).get('/api/v1/memory/stats').expect(401);
    const outsider = await loginAgent(app, w.outsider);
    await outsider.post('/api/v1/memory/check').send({ productId: w.liveId, kind: 'idea', title: 'x' }).expect(403);
    await outsider.post('/api/v1/memory/check').send({ productId: w.pulseId, kind: 'nope', title: 'x' }).expect(400);
    await outsider.post('/api/v1/memory/check').send({ productId: w.pulseId, kind: 'idea', title: '' }).expect(400);
    const ok = await outsider.post('/api/v1/memory/check').send({ productId: w.pulseId, kind: 'idea', title: 'Anything' }).expect(200);
    expect(memoryCheckResultSchema.parse(ok.body)).toEqual({ status: 'unique', matches: [] });
  });

  it('skips the idea being edited, and reports the memory size', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.maker);
    const created = (await agent.post('/api/v1/ideas').send(idea(w.liveId, 'Their clock, not yours')).expect(201)).body as { id: string };
    const hit = await agent.post('/api/v1/memory/check').send({ productId: w.pulseId, kind: 'idea', title: 'Their clock not yours' }).expect(200);
    expect(hit.body.status).toBe('duplicate');
    const own = await agent
      .post('/api/v1/memory/check')
      .send({ productId: w.liveId, kind: 'idea', title: 'Their clock not yours', excludeIdeaId: created.id })
      .expect(200);
    expect(own.body.status).toBe('unique');

    const stats = memoryStatsSchema.parse((await agent.get('/api/v1/memory/stats').expect(200)).body);
    expect(stats).toMatchObject({ total: 1, withEmbedding: 0, embeddings: { enabled: false, model: null } });
    expect(stats.bySourceType).toMatchObject({ idea: 1, brief_hook: 0, post_caption: 0, dropped_draft: 0 });
    expect(stats.thresholds.textDuplicate).toBe(0.55);
    expect(stats.lastAddedAt).not.toBeNull();
  });
});

describe('memory.backfill', () => {
  it('loads older ideas, hooks and published captions once (idempotent)', async () => {
    const w = await world();
    await db.insert(ideas).values([
      { productId: w.liveId, title: 'Their clock, not yours', mode: 'M3' },
      { productId: w.liveId, title: 'Their clock, NOT yours!', mode: 'M3' },
      { productId: w.pulseId, title: 'One question, whole office', mode: 'M5', deletedAt: new Date() },
    ]);
    const [b] = await db
      .insert(briefs)
      .values({ code: 'REEL-902', productId: w.liveId, title: 'Sunday call', mode: 'M1', hook: 'Mum calls at six', stage: 'live' })
      .returning();
    const [channel] = await db.insert(channelAccounts).values({ platform: 'instagram', displayName: 'IG', status: 'connected', allowedActions: ['publish'] }).returning();
    await db.insert(posts).values({ briefId: b!.id, briefVersion: 1, channelAccountId: channel!.id, caption: 'Call mum.', status: 'published', publishedAt: new Date() });

    expect(await backfillMemory()).toEqual({ ideas: 2, hooks: 1, captions: 1, skipped: 1, embedded: 0 });
    // The skipped one is a fingerprint repeat; running again adds nothing new.
    const again = await backfillMemory();
    expect(again).toMatchObject({ ideas: 0, hooks: 0, captions: 0 });
    expect(await db.select().from(contentMemory)).toHaveLength(4);
  });
});
