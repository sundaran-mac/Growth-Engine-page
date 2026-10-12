import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analyticsByChannelSchema,
  analyticsByModeSchema,
  analyticsPostsResponseSchema,
  analyticsSummarySchema,
  dashboardResponseSchema,
  keywordEventListResponseSchema,
  keywordRuleListResponseSchema,
  leadActivityListResponseSchema,
  leadListResponseSchema,
  leadViewSchema,
  notificationListResponseSchema,
  weeklyNoteSchema,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  approvals,
  auditLogs,
  keywordEvents,
  leadActivities,
  leads,
  metricSnapshots,
  notifications,
  planItems,
  plans,
  weeklyNotes,
} from '../../db/schema/index.js';
import { setClaudeClientForTests, type ClaudeClient } from '../../lib/claude.js';
import { dateKey, weekStartKey } from '../../lib/time.js';
import {
  TEST_ORIGIN,
  addMember,
  createTestProduct,
  createTestUser,
  loginAgent,
  truncateAll,
} from '../../../test/helpers.js';
import { sendInstagramPrivateReply } from '../publish/shared.js';
import { addDays } from './logic.js';
import { runNightlyMetrics } from './metrics-nightly.js';
import { writeMondayNote } from './shared.js';
import {
  makeAccount,
  makeBrief,
  makeKeywordRule,
  makePost,
  makeSnapshot,
} from './test-fixtures.js';
import { setMetaWebhookConfigForTests } from './webhook.js';

vi.mock('../publish/shared.js', () => ({
  sendInstagramPrivateReply: vi.fn(),
  createDraftPostsForBrief: vi.fn(),
}));
const sendReplyMock = vi.mocked(sendInstagramPrivateReply);

const EM_DASH = String.fromCharCode(0x2014);
const app = createApp();
const API = '/api/v1';
const today = () => dateKey(new Date(), env.appTimezone);

beforeEach(async () => {
  await truncateAll();
  sendReplyMock.mockReset();
  setClaudeClientForTests(null);
});

afterEach(() => {
  setMetaWebhookConfigForTests(undefined);
  setClaudeClientForTests(null);
});

async function editorAgent() {
  const user = await createTestUser({ role: 'editor', name: 'Jeeva Santiago' });
  return { user, agent: await loginAgent(app, user) };
}

/* ---------- Dashboard ---------- */

describe('GET /dashboard', () => {
  it('needs a session', async () => {
    const res = await request(app).get(`${API}/dashboard`).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a bad product id', async () => {
    const { agent } = await editorAgent();
    const res = await agent.get(`${API}/dashboard`).query({ productId: 'nope' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('sums daily snapshots, compares with the previous 7 days and lists what needs me', async () => {
    const { user, agent } = await editorAgent();
    const product = await createTestProduct({ name: 'Humini Live' });
    const brief = await makeBrief(product.id, { title: 'Their clock, not yours', version: 2 });
    const ig = await makeAccount('instagram');
    const wa = await makeAccount('whatsapp', { status: 'manual' });
    const post = await makePost(brief.id, ig.id, { externalId: 'm1' });
    const d = today();
    await makeSnapshot(post.id, d, { reach: 1000, saves: 10, shares: 5, installs: 3 });
    await makeSnapshot(post.id, addDays(d, -3), { reach: 200, saves: 2, installs: 1 });
    await makeSnapshot(post.id, addDays(d, -8), { reach: 1000, saves: 4, installs: 2 });

    // Today's posts: one auto, one by hand.
    const later = new Date(Date.now() + 60_000);
    await makePost(brief.id, ig.id, { status: 'scheduled', scheduledAt: later });
    await makePost(brief.id, wa.id, { status: 'manual_pending', scheduledAt: later });

    // Approvals: one for me on the current version, one stale.
    const due = new Date(Date.now() + 86_400_000);
    await db.insert(approvals).values([
      { briefId: brief.id, version: 2, gate: 'claims', approverId: user.id, dueAt: due },
      { briefId: brief.id, version: 1, gate: 'brand', approverId: user.id, dueAt: due },
    ]);
    // A draft plan for this month with an unbooked shoot.
    const [plan] = await db
      .insert(plans)
      .values({ productId: product.id, month: d.slice(0, 7) })
      .returning();
    await db.insert(planItems).values([
      { planId: plan!.id, date: d, title: 'Founder film', needsShootSlot: true },
      { planId: plan!.id, date: d, title: 'Poster' },
    ]);
    // Keyword comments waiting.
    const rule = await makeKeywordRule(product.id);
    await db.insert(keywordEvents).values([
      { ruleId: rule.id, platform: 'instagram', externalCommentId: 'c1' },
      { ruleId: rule.id, platform: 'instagram', externalCommentId: 'c2' },
    ]);
    await db.insert(leads).values([
      { productId: product.id, organisation: 'A', stage: 'new' },
      { productId: product.id, organisation: 'B', stage: 'won' },
    ]);

    const res = await agent.get(`${API}/dashboard`).query({ productId: product.id }).expect(200);
    const body = dashboardResponseSchema.parse(res.body);
    expect(body.stats.reach7d).toEqual({ value: 1200, previous: 1000, deltaPct: 20 });
    expect(body.stats.savesShares7d.value).toBe(17);
    expect(body.stats.installs7d).toEqual({ value: 4, previous: 2, deltaPct: 100 });
    expect(body.stats.openLeads).toEqual({ value: 1, newThisWeek: 1 });
    expect(body.pipeline.new).toBe(1);
    expect(body.pipeline.won).toBe(1);

    const kinds = body.needsYou.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'approval')).toHaveLength(1);
    expect(body.needsYou.find((n) => n.kind === 'approval')?.title).toContain('Approve claims');
    const planItem = body.needsYou.find((n) => n.kind === 'plan_to_freeze');
    expect(planItem?.meta).toContain('2 pieces');
    expect(planItem?.meta).toContain('1 shoot unbooked');
    expect(body.needsYou.find((n) => n.kind === 'keyword_comments')?.title).toBe(
      '2 comments asked for the link',
    );

    const deliveries = body.goingOutToday.map((p) => p.delivery).sort();
    expect(deliveries).toEqual(['auto', 'auto', 'manual']); // published, scheduled, WhatsApp
    expect(body.nextPosts.map((p) => p.platform).sort()).toEqual(['instagram', 'whatsapp']);
    expect(body.products.find((p) => p.id === product.id)?.piecesThisWeek).toBe(1);
  });

  it('hides keyword comments and plans from a member without a role on the product', async () => {
    const member = await createTestUser({ role: 'member' });
    const agent = await loginAgent(app, member);
    const product = await createTestProduct();
    const rule = await makeKeywordRule(product.id);
    await db
      .insert(keywordEvents)
      .values({ ruleId: rule.id, platform: 'instagram', externalCommentId: 'c1' });
    await db.insert(plans).values({ productId: product.id, month: today().slice(0, 7) });
    const res = await agent.get(`${API}/dashboard`).expect(200);
    expect(dashboardResponseSchema.parse(res.body).needsYou).toEqual([]);
  });
});

/* ---------- Analytics ---------- */

describe('analytics', () => {
  async function seedAnalytics() {
    const product = await createTestProduct();
    const other = await createTestProduct();
    const founder = await makeBrief(product.id, { mode: 'M1' });
    const poster = await makeBrief(product.id, { mode: 'M4' });
    const otherBrief = await makeBrief(other.id, { mode: 'M1' });
    const ig = await makeAccount('instagram');
    const yt = await makeAccount('youtube');
    const p1 = await makePost(founder.id, ig.id, { externalId: 'sample-1' });
    const p2 = await makePost(founder.id, yt.id);
    const p3 = await makePost(poster.id, ig.id);
    const p4 = await makePost(otherBrief.id, ig.id);
    const d = today();
    await makeSnapshot(p1.id, d, { reach: 1000, saves: 10, installs: 4, activations: 2 });
    await makeSnapshot(p1.id, addDays(d, -1), { reach: 1000, saves: 10 });
    await makeSnapshot(p2.id, d, { reach: 500, installs: 1 });
    await makeSnapshot(p3.id, addDays(d, -2), { reach: 1000, shares: 2 });
    await makeSnapshot(p3.id, addDays(d, -40), { reach: 9999 });
    await makeSnapshot(p4.id, d, { reach: 7777 });
    return { product, p1, p3 };
  }

  it('summarises a window for one product', async () => {
    const { agent } = await editorAgent();
    const { product } = await seedAnalytics();
    const res = await agent
      .get(`${API}/analytics/summary`)
      .query({ productId: product.id, days: 28 })
      .expect(200);
    const body = analyticsSummarySchema.parse(res.body);
    expect(body.totals.reach).toBe(3500);
    expect(body.totals.installs).toBe(5);
    expect(body.activationRatePct).toBe(40);
    expect(body.previous.reach).toBe(9999);
    expect(body.deltas.reach).toBe(-65);
    expect(body.reachByWeek.length).toBeGreaterThanOrEqual(8);
    // The weekly trend spans at least 8 weeks, so it also holds the older snapshot.
    expect(body.reachByWeek.reduce((s, w) => s + w.reach, 0)).toBe(13499);
    expect(body.isSample).toBe(false);
    expect(body.hasData).toBe(true);
  });

  it('groups by channel and by mode with distinct pieces and the best channel', async () => {
    const { agent } = await editorAgent();
    const { product } = await seedAnalytics();
    const ch = analyticsByChannelSchema.parse(
      (await agent.get(`${API}/analytics/by-channel`).query({ productId: product.id }).expect(200))
        .body,
    );
    expect(ch.items.map((i) => [i.platform, i.installs, i.reach])).toEqual([
      ['instagram', 4, 3000],
      ['youtube', 1, 500],
    ]);
    const md = analyticsByModeSchema.parse(
      (await agent.get(`${API}/analytics/by-mode`).query({ productId: product.id }).expect(200))
        .body,
    );
    const m1 = md.items.find((i) => i.mode === 'M1')!;
    expect(m1.pieces).toBe(1);
    expect(m1.reach).toBe(2500);
    expect(m1.bestChannel).toBe('instagram'); // 110 per 1K reach on Instagram vs 40 on YouTube
    expect(md.items.find((i) => i.mode === 'M4')?.pieces).toBe(1);
  });

  it('lists posts with the ladder, paged and sorted', async () => {
    const { agent } = await editorAgent();
    const { product, p3 } = await seedAnalytics();
    const res = await agent
      .get(`${API}/analytics/posts`)
      .query({ productId: product.id, sort: 'reach', limit: 1 })
      .expect(200);
    const body = analyticsPostsResponseSchema.parse(res.body);
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.reach).toBe(2000);
    const page2 = analyticsPostsResponseSchema.parse(
      (
        await agent
          .get(`${API}/analytics/posts`)
          .query({ productId: product.id, sort: 'reach', limit: 1, offset: 1 })
          .expect(200)
      ).body,
    );
    expect(page2.items[0]!.postId).toBe(p3.id);
  });

  it('marks sample data and validates the range', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    const brief = await makeBrief(product.id);
    const post = await makePost(brief.id, (await makeAccount('instagram')).id, {
      externalId: 'sample-x',
    });
    await makeSnapshot(post.id, today(), { reach: 10 });
    const res = await agent
      .get(`${API}/analytics/summary`)
      .query({ productId: product.id, days: 7 })
      .expect(200);
    expect(res.body.isSample).toBe(true);
    const bad = await agent.get(`${API}/analytics/summary`).query({ days: 30 }).expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });
});

/* ---------- Monday note ---------- */

describe('Monday note', () => {
  it('falls back to the ecosystem note', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    const monday = weekStartKey(new Date(), env.appTimezone);
    await db.insert(weeklyNotes).values({ productId: null, weekStart: monday, body: 'Eco note' });
    const res = await agent.get(`${API}/notes/latest`).query({ productId: product.id }).expect(200);
    expect(res.body.isEcosystem).toBe(true);
    expect(res.body.note.body).toBe('Eco note');
  });

  it('writes a note from the numbers when Claude is not set up, once per week', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct({ name: 'Humini Live' });
    const monday = weekStartKey(new Date(), env.appTimezone);
    const brief = await makeBrief(product.id, { mode: 'M1' });
    const poster = await makeBrief(product.id, { mode: 'M4' });
    const ig = await makeAccount('instagram');
    await makeSnapshot((await makePost(brief.id, ig.id)).id, addDays(monday, -2), {
      reach: 1000,
      installs: 4,
    });
    await makeSnapshot((await makePost(poster.id, ig.id)).id, addDays(monday, -3), {
      reach: 1000,
      saves: 1,
    });

    const first = await agent
      .post(`${API}/notes/generate`)
      .send({ productId: product.id })
      .expect(201);
    const note = weeklyNoteSchema.parse(first.body);
    expect(note.weekStart).toBe(monday);
    expect(note.doMore).toContain('M1 Founder films');
    expect(note.stopDoing).toContain('M4 Posters');
    expect(note.body).toContain('Claude is not set up');
    expect(JSON.stringify(note)).not.toContain(EM_DASH);

    const again = await agent
      .post(`${API}/notes/generate`)
      .send({ productId: product.id })
      .expect(200);
    expect(again.body.id).toBe(note.id);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'note.write'));
    expect(audit).toHaveLength(1);
  });

  it('uses Claude when it is set up and cleans the text', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    const parse = vi.fn().mockResolvedValue({
      model: 'claude-test',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      parsed_output: {
        summary: `Good week ${EM_DASH} reach went up.`,
        doMore: 'More founder films.',
        stop: 'Stop long explainers.',
      },
    });
    setClaudeClientForTests({ beta: { messages: { parse } } } as unknown as ClaudeClient);
    const res = await agent
      .post(`${API}/notes/generate`)
      .send({ productId: product.id })
      .expect(201);
    expect(res.body.body).toBe('Good week, reach went up.');
    expect(res.body.doMore).toBe('More founder films.');
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('checks roles and the Monday rule', async () => {
    const product = await createTestProduct();
    const viewer = await loginAgent(app, await createTestUser({ role: 'viewer' }));
    await viewer.post(`${API}/notes/generate`).send({ productId: product.id }).expect(403);
    const makerUser = await createTestUser({ role: 'member' });
    await addMember(product.id, makerUser.id, 'maker');
    const maker = await loginAgent(app, makerUser);
    await maker.post(`${API}/notes/generate`).send({ productId: product.id }).expect(403);
    const ownerUser = await createTestUser({ role: 'member' });
    await addMember(product.id, ownerUser.id, 'owner');
    const owner = await loginAgent(app, ownerUser);
    const bad = await owner
      .post(`${API}/notes/generate`)
      .send({ productId: product.id, weekStart: '2026-10-13' })
      .expect(400);
    expect(bad.body.detail).toMatch(/Monday/);
  });

  it('writeMondayNote returns the shared shape and is idempotent', async () => {
    const product = await createTestProduct();
    const a = await writeMondayNote(product.id, '2026-10-12');
    const b = await writeMondayNote(product.id, '2026-10-12');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ productId: product.id, weekStart: '2026-10-12' });
    expect(a.doMore.length).toBeGreaterThan(0);
    expect(a.stop.length).toBeGreaterThan(0);
  });
});

/* ---------- Leads ---------- */

describe('leads', () => {
  it('creates a lead with an activity and an audit row', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    const res = await agent
      .post(`${API}/leads`)
      .send({
        productId: product.id,
        organisation: '  Tamil Sangam, Singapore ',
        who: 'Community secretary',
        nextStep: 'Intro call',
      })
      .expect(201);
    const lead = leadViewSchema.parse(res.body);
    expect(lead.organisation).toBe('Tamil Sangam, Singapore');
    expect(lead.stage).toBe('new');
    expect(lead.source).toBe('manual');
    const acts = await db.select().from(leadActivities).where(eq(leadActivities.leadId, lead.id));
    expect(acts).toHaveLength(1);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'lead.create'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/price|amount/i);
  });

  it('validates and enforces roles', async () => {
    const product = await createTestProduct();
    const viewer = await loginAgent(app, await createTestUser({ role: 'viewer' }));
    await viewer
      .post(`${API}/leads`)
      .send({ productId: product.id, organisation: 'X' })
      .expect(403);
    const memberUser = await createTestUser({ role: 'member' });
    const member = await loginAgent(app, memberUser);
    await member
      .post(`${API}/leads`)
      .send({ productId: product.id, organisation: 'X' })
      .expect(403);
    await addMember(product.id, memberUser.id, 'maker');
    const member2 = await loginAgent(app, memberUser);
    await member2
      .post(`${API}/leads`)
      .send({ productId: product.id, organisation: 'X' })
      .expect(201);
    const bad = await member2
      .post(`${API}/leads`)
      .send({ productId: product.id, organisation: '' })
      .expect(400);
    expect(bad.body.errors[0].path).toBe('body.organisation');
    await request(app).post(`${API}/leads`).set('Origin', TEST_ORIGIN).send({}).expect(401);
  });

  it('lists without lost leads unless asked', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    await db.insert(leads).values([
      { productId: product.id, organisation: 'A', stage: 'new' },
      { productId: product.id, organisation: 'B', stage: 'lost' },
    ]);
    const list = leadListResponseSchema.parse(
      (await agent.get(`${API}/leads`).query({ productId: product.id }).expect(200)).body,
    );
    expect(list.items.map((l) => l.organisation)).toEqual(['A']);
    const all = await agent
      .get(`${API}/leads`)
      .query({ productId: product.id, includeLost: 'true' })
      .expect(200);
    expect(all.body.total).toBe(2);
  });

  it('edits, moves with a stage-change activity, and logs a call', async () => {
    const { agent } = await editorAgent();
    const product = await createTestProduct();
    const [lead] = await db
      .insert(leads)
      .values({ productId: product.id, organisation: 'A' })
      .returning();
    const id = lead!.id;

    const patched = await agent
      .patch(`${API}/leads/${id}`)
      .send({ nextStep: 'Intro call · Thu', who: '' })
      .expect(200);
    expect(patched.body.nextStep).toBe('Intro call · Thu');
    expect(patched.body.who).toBeNull();
    await agent.patch(`${API}/leads/${id}`).send({}).expect(400);

    const moved = await agent
      .post(`${API}/leads/${id}/move`)
      .send({ stage: 'talking', note: 'Good call' })
      .expect(200);
    expect(moved.body.stage).toBe('talking');
    const same = await agent.post(`${API}/leads/${id}/move`).send({ stage: 'talking' }).expect(409);
    expect(same.body.code).toBe('LEAD_STAGE_UNCHANGED');

    await agent
      .post(`${API}/leads/${id}/activities`)
      .send({ kind: 'call', body: 'Called the secretary' })
      .expect(201);
    await agent
      .post(`${API}/leads/${id}/activities`)
      .send({ kind: 'stage_change', body: 'x' })
      .expect(400);
    const acts = leadActivityListResponseSchema.parse(
      (await agent.get(`${API}/leads/${id}/activities`).expect(200)).body,
    );
    expect(acts.items.map((a) => a.kind)).toEqual(['call', 'stage_change']);
    expect(acts.items[1]).toMatchObject({
      fromStage: 'new',
      toStage: 'talking',
      body: 'Good call',
    });

    await agent.get(`${API}/leads/00000000-0000-4000-8000-000000000000`).expect(404);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
    expect(audits.map((a) => a.action).sort()).toEqual([
      'lead.activity',
      'lead.move',
      'lead.update',
    ]);
  });
});

/* ---------- Keyword rules ---------- */

describe('keyword rules', () => {
  it('lets an owner create and edit rules; makers cannot', async () => {
    const product = await createTestProduct();
    const ownerUser = await createTestUser({ role: 'member' });
    await addMember(product.id, ownerUser.id, 'owner');
    const owner = await loginAgent(app, ownerUser);
    const created = await owner
      .post(`${API}/keyword-rules`)
      .send({
        productId: product.id,
        keyword: ' circle ',
        replyText: 'Here is the link',
        link: 'https://live.humini.app',
      })
      .expect(201);
    expect(created.body.keyword).toBe('CIRCLE');
    await owner
      .post(`${API}/keyword-rules`)
      .send({ productId: product.id, keyword: 'two words', replyText: 'x' })
      .expect(400);
    await owner
      .post(`${API}/keyword-rules`)
      .send({ productId: product.id, keyword: 'circle', replyText: 'x' })
      .expect(409);

    const makerUser = await createTestUser({ role: 'member' });
    await addMember(product.id, makerUser.id, 'maker');
    const maker = await loginAgent(app, makerUser);
    await maker
      .patch(`${API}/keyword-rules/${created.body.id}`)
      .send({ active: false })
      .expect(403);

    const off = await owner
      .patch(`${API}/keyword-rules/${created.body.id}`)
      .send({ active: false })
      .expect(200);
    expect(off.body.active).toBe(false);
    const list = keywordRuleListResponseSchema.parse(
      (await owner.get(`${API}/keyword-rules`).query({ productId: product.id }).expect(200)).body,
    );
    expect(list.items).toHaveLength(1);
  });
});

/* ---------- Meta webhook ---------- */

describe('Meta webhook', () => {
  const SECRET = 'app-secret';
  const sign = (body: string) =>
    `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const comment = (id: string, text: string, mediaId = 'media-11') =>
    JSON.stringify({
      object: 'instagram',
      entry: [
        {
          id: 'ig-account',
          time: 1,
          changes: [
            {
              field: 'comments',
              value: {
                id,
                text,
                from: { id: 'u1', username: 'tamilsangam' },
                media: { id: mediaId },
              },
            },
          ],
        },
      ],
    });

  beforeEach(() =>
    setMetaWebhookConfigForTests({ appSecret: SECRET, webhookVerifyToken: 'verify-me' }),
  );

  it('answers the subscription check', async () => {
    const ok = await request(app)
      .get(`${API}/webhooks/meta`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' })
      .expect(200);
    expect(ok.text).toBe('12345');
    await request(app)
      .get(`${API}/webhooks/meta`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' })
      .expect(403);
    setMetaWebhookConfigForTests(null);
    const off = await request(app)
      .get(`${API}/webhooks/meta`)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' })
      .expect(503);
    expect(off.body.code).toBe('FEATURE_DISABLED');
  });

  it('rejects a bad signature', async () => {
    const body = comment('c1', 'CIRCLE');
    const res = await request(app)
      .post(`${API}/webhooks/meta`)
      // Lead request: origin-check exempts '/api/v1/webhooks/' but sees '/webhooks/...' under the mount.
      .set('Origin', TEST_ORIGIN)
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign('{}'))
      .send(body)
      .expect(401);
    expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await db.select().from(leads)).toHaveLength(0);
  });

  it('turns a keyword comment into one lead and one reply, and ignores retries', async () => {
    const product = await createTestProduct();
    const brief = await makeBrief(product.id);
    const ig = await makeAccount('instagram', { externalAccountId: 'ig-account' });
    const post = await makePost(brief.id, ig.id, {
      externalId: 'media-11',
      trackedUrl: 'https://live.humini.app/?utm_content=REEL',
    });
    await makeKeywordRule(product.id);
    sendReplyMock.mockResolvedValue({ status: 'sent', externalId: 'dm-1' });

    const body = comment('c1', 'circle please');
    const send = () =>
      request(app)
        .post(`${API}/webhooks/meta`)
        .set('Origin', TEST_ORIGIN)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(body))
        .send(body)
        .expect(200);
    const first = await send();
    expect(first.body).toEqual({ received: 1, matched: 1, duplicates: 0, leadsCreated: 1 });
    const second = await send();
    expect(second.body).toEqual({ received: 1, matched: 1, duplicates: 1, leadsCreated: 0 });

    const allLeads = await db.select().from(leads);
    expect(allLeads).toHaveLength(1);
    expect(allLeads[0]).toMatchObject({
      source: 'keyword_reply',
      sourcePostId: post.id,
      organisation: '@tamilsangam',
      stage: 'new',
    });
    expect(sendReplyMock).toHaveBeenCalledTimes(1);
    expect(sendReplyMock.mock.calls[0]![0]).toEqual({
      channelAccountId: ig.id,
      commentId: 'c1',
      message: 'Here is the link\nhttps://live.humini.app/?utm_content=REEL',
    });
    const [event] = await db.select().from(keywordEvents);
    expect(event).toMatchObject({ replyStatus: 'sent', leadId: allLeads[0]!.id });
  });

  it('keeps the reply queued when the account is not connected, and skips non-matching comments', async () => {
    const product = await createTestProduct();
    const brief = await makeBrief(product.id);
    const ig = await makeAccount('instagram', { externalAccountId: 'ig-account' });
    await makePost(brief.id, ig.id, { externalId: 'media-11' });
    await makeKeywordRule(product.id);
    sendReplyMock.mockResolvedValue({ status: 'queued', reason: 'NOT_CONNECTED' });

    for (const [id, text] of [
      ['c1', 'CIRCLE'],
      ['c2', 'nice reel'],
    ] as const) {
      const body = comment(id, text);
      await request(app)
        .post(`${API}/webhooks/meta`)
        .set('Origin', TEST_ORIGIN)
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', sign(body))
        .send(body)
        .expect(200);
    }
    const events = await db.select().from(keywordEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ replyStatus: 'queued', error: 'NOT_CONNECTED' });
    const { agent } = await editorAgent();
    const list = keywordEventListResponseSchema.parse(
      (
        await agent
          .get(`${API}/keyword-events`)
          .query({ productId: product.id, status: 'queued' })
          .expect(200)
      ).body,
    );
    expect(list.total).toBe(1);
  });
});

/* ---------- Notifications ---------- */

describe('notifications', () => {
  it('lists, reads and reads all, only for the signed-in user', async () => {
    const { user, agent } = await editorAgent();
    const other = await createTestUser();
    const [mine] = await db
      .insert(notifications)
      .values([
        { userId: user.id, kind: 'system', title: 'One', link: '/' },
        { userId: user.id, kind: 'system', title: 'Two' },
      ])
      .returning();
    const [theirs] = await db
      .insert(notifications)
      .values({ userId: other.id, kind: 'system', title: 'Theirs' })
      .returning();

    const list = notificationListResponseSchema.parse(
      (await agent.get(`${API}/notifications`).expect(200)).body,
    );
    expect(list.total).toBe(2);
    expect(list.unreadCount).toBe(2);

    const read = await agent.post(`${API}/notifications/${mine!.id}/read`).expect(200);
    expect(read.body.readAt).not.toBeNull();
    await agent.post(`${API}/notifications/${theirs!.id}/read`).expect(404);
    await agent.post(`${API}/notifications/not-a-uuid/read`).expect(400);

    const all = await agent.post(`${API}/notifications/read-all`).expect(200);
    expect(all.body).toEqual({ updated: 1 });
    const unread = await agent.get(`${API}/notifications`).query({ unread: 'true' }).expect(200);
    expect(unread.body.total).toBe(0);
    const [stillUnread] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, theirs!.id)));
    expect(stillUnread!.readAt).toBeNull();
    await request(app).post(`${API}/notifications/read-all`).set('Origin', TEST_ORIGIN).expect(401);
  });
});

/* ---------- Nightly metrics ---------- */

describe('metrics.nightly', () => {
  it('stores the daily value from lifetime totals and skips posts without numbers', async () => {
    const product = await createTestProduct();
    const brief = await makeBrief(product.id);
    const ig = await makeAccount('instagram');
    const wa = await makeAccount('whatsapp');
    const post = await makePost(brief.id, ig.id, {
      externalId: 'm1',
      publishedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    await makePost(brief.id, wa.id, { externalId: 'w1' });
    const now = new Date();
    const yesterday = addDays(dateKey(now, env.appTimezone), -1);
    await makeSnapshot(post.id, addDays(yesterday, -1), { reach: 700, saves: 5 });

    const result = await runNightlyMetrics(
      async (p) => (p.platform === 'instagram' ? { reach: 1000, saves: 4, shares: 2 } : null),
      { now },
    );
    expect(result).toMatchObject({ date: yesterday, posts: 2, stored: 1, skipped: 1, failed: 0 });
    const [snap] = await db
      .select()
      .from(metricSnapshots)
      .where(and(eq(metricSnapshots.postId, post.id), eq(metricSnapshots.date, yesterday)));
    expect(snap).toMatchObject({ reach: 300, saves: 0, shares: 2 });

    // Running again for the same day updates the row instead of adding one.
    await runNightlyMetrics(async () => ({ reach: 1100 }), { now });
    const rows = await db.select().from(metricSnapshots).where(eq(metricSnapshots.postId, post.id));
    expect(rows).toHaveLength(2);
  });

  it('counts a failing fetch and keeps going', async () => {
    const product = await createTestProduct();
    const brief = await makeBrief(product.id);
    const ig = await makeAccount('instagram');
    await makePost(brief.id, ig.id, { externalId: 'm1' });
    const result = await runNightlyMetrics(async () => {
      throw new Error('platform down');
    });
    expect(result.failed).toBe(1);
  });
});
