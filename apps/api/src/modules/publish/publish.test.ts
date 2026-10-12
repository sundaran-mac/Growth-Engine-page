/**
 * Publish module integration tests (Supertest + real Postgres). Settings and the queue are mocked.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  channelAccountViewSchema,
  postViewSchema,
  publishBriefSummarySchema,
  publishQueueItemSchema,
  scheduleAllResponseSchema,
  trackedLinkSchema,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { db } from '../../db/client.js';
import {
  auditLogs,
  briefs,
  channelAccounts,
  metricSnapshots,
  posts,
  productChannels,
  productSettings,
} from '../../db/schema/index.js';
import { addMember, createTestProduct, createTestUser, loginAgent, truncateAll, type TestUser } from '../../../test/helpers.js';
import type * as settingsShared from '../settings/shared.js';
import { nextFreeSlots } from '../settings/shared.js';
import { postPublishJob } from './jobs.js';
import { createDraftPostsForBrief } from './shared.js';
import { makeAsset, makeBrief, makeChannel, setProductOwner } from './test-fixtures.js';

vi.mock('../settings/shared.js', async (importOriginal) => ({
  ...(await importOriginal<typeof settingsShared>()),
  nextFreeSlots: vi.fn(),
}));
vi.mock('./jobs.js', () => {
  const job = (name: string) => ({ name, send: vi.fn().mockResolvedValue('job-id'), schedule: vi.fn(), work: vi.fn() });
  return {
    postPublishJob: job('post.publish'),
    postSweepJob: job('post.sweep'),
    whatsappReminderJob: job('whatsapp.reminder'),
    tokenRefreshJob: job('channel.token-refresh'),
  };
});

const app = createApp();
const slotsMock = vi.mocked(nextFreeSlots);
const notImplemented = Object.assign(new Error('nextFreeSlots is not implemented yet.'), { code: 'NOT_IMPLEMENTED' });

interface World {
  productId: string;
  admin: TestUser;
  owner: TestUser;
  editor: TestUser;
  reviewer: TestUser;
  outsider: TestUser;
  brief: { id: string; code: string };
  ig: string;
  li: string;
  wa: string;
}

async function world(opts: { autoSchedule?: boolean } = {}): Promise<World> {
  const product = await createTestProduct({ slug: 'live' });
  const admin = await createTestUser({ role: 'admin' });
  const owner = await createTestUser({ role: 'member', name: 'Live Owner' });
  const editor = await createTestUser({ role: 'editor', name: 'Jeeva Santiago' });
  const reviewer = await createTestUser({ role: 'member' });
  const outsider = await createTestUser({ role: 'editor' });
  await addMember(product.id, owner.id, 'owner');
  await addMember(product.id, editor.id, 'maker');
  await addMember(product.id, reviewer.id, 'reviewer');
  await setProductOwner(product.id, owner.id);
  if (opts.autoSchedule !== undefined) {
    await db.insert(productSettings).values({ productId: product.id, autoSchedule: opts.autoSchedule, utmCampaignPrefix: 'live' });
  }
  const ig = await makeChannel({ platform: 'instagram', actions: ['publish', 'insights'] });
  const li = await makeChannel({ platform: 'linkedin', status: 'needs_approval', withToken: false, actions: [] });
  const wa = await makeChannel({ platform: 'whatsapp', status: 'manual', withToken: false, actions: [] });
  const brief = await makeBrief({ productId: product.id, ownerId: owner.id });
  await makeAsset(brief.id);
  return { productId: product.id, admin, owner, editor, reviewer, outsider, brief, ig: ig.id, li: li.id, wa: wa.id };
}

async function postsOf(briefId: string) {
  return db.select({ post: posts, platform: channelAccounts.platform }).from(posts).innerJoin(channelAccounts, eq(posts.channelAccountId, channelAccounts.id)).where(eq(posts.briefId, briefId));
}

async function briefStage(id: string) {
  const [b] = await db.select({ stage: briefs.stage }).from(briefs).where(eq(briefs.id, id));
  return b?.stage;
}

beforeEach(async () => {
  await truncateAll();
  slotsMock.mockReset();
  slotsMock.mockRejectedValue(notImplemented);
  vi.mocked(postPublishJob.send).mockClear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('createDraftPostsForBrief', () => {
  it('makes one post per channel, schedules auto channels, reminds WhatsApp, and is idempotent', async () => {
    const w = await world();
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    const byPlatform = Object.fromEntries(created.map((p) => [p.platform, p]));
    expect(Object.keys(byPlatform).sort()).toEqual(['instagram', 'linkedin', 'whatsapp']);
    expect(byPlatform.instagram).toMatchObject({ status: 'scheduled', format: '9:16 · 58 s', languages: ['en', 'ta'] });
    expect(byPlatform.instagram!.scheduledAt).not.toBeNull();
    expect(byPlatform.instagram!.caption).toBe('Why we built Live\n\nTry it tonight\n\nLink in bio.');
    expect(byPlatform.instagram!.trackedUrl).toContain(`utm_content=${w.brief.code}`);
    expect(byPlatform.instagram!.trackedUrl).toContain('utm_campaign=live-founder-');
    expect(byPlatform.linkedin).toMatchObject({ status: 'draft' });
    expect(byPlatform.whatsapp).toMatchObject({ status: 'manual_pending' });
    expect(byPlatform.whatsapp!.scheduledAt).not.toBeNull();
    expect(await briefStage(w.brief.id)).toBe('scheduled');

    const again = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    expect(again.map((p) => p.id).sort()).toEqual(created.map((p) => p.id).sort());
    expect(await postsOf(w.brief.id)).toHaveLength(3);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'post.create_drafts'));
    expect(audit).toHaveLength(1);
  });

  it('leaves posts as drafts without a time when auto schedule is off (WhatsApp still gets a time)', async () => {
    const w = await world({ autoSchedule: false });
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    const ig = created.find((p) => p.platform === 'instagram')!;
    expect(ig).toMatchObject({ status: 'draft', scheduledAt: null });
    expect(created.find((p) => p.platform === 'whatsapp')).toMatchObject({ status: 'manual_pending' });
    expect(await briefStage(w.brief.id)).toBe('scheduled');
  });

  it('takes the next free posting slot from settings when there is one', async () => {
    const w = await world();
    const at = new Date('2026-12-01T14:00:00Z');
    slotsMock.mockImplementation(async (_p, platform) =>
      platform === 'instagram' ? [{ at, audienceTimezone: 'Asia/Singapore', slotId: 's1' }] : [],
    );
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    const ig = created.find((p) => p.platform === 'instagram')!;
    expect(ig.scheduledAt).toBe(at.toISOString());
    expect(ig.audienceTz).toBe('Asia/Singapore');
    expect(slotsMock).toHaveBeenCalledWith(w.productId, 'instagram', expect.any(Date), 1, expect.anything());
  });

  it('uses only enabled product channels when the product chose them', async () => {
    const w = await world();
    const ig2 = await makeChannel({ platform: 'instagram' });
    await db.insert(productChannels).values([
      { productId: w.productId, channelAccountId: w.ig, enabled: false },
      { productId: w.productId, channelAccountId: ig2.id, enabled: true, defaultRatio: '9:16' },
    ]);
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    expect(created.filter((p) => p.platform === 'instagram').map((p) => p.channelAccountId)).toEqual([ig2.id]);
    // LinkedIn is not chosen; WhatsApp always gets its reminder.
    expect(created.map((p) => p.platform).sort()).toEqual(['instagram', 'whatsapp']);
  });

  it('replaces unpublished posts of an older version', async () => {
    const w = await world();
    await createDraftPostsForBrief(w.brief.id, w.admin.id);
    await db.update(briefs).set({ version: 2, stage: 'approved' }).where(eq(briefs.id, w.brief.id));
    const { approvals } = await import('../../db/schema/index.js');
    for (const gate of ['claims', 'brand'] as const) {
      await db.insert(approvals).values({ briefId: w.brief.id, version: 2, gate, decision: 'approved', decidedAt: new Date(), dueAt: new Date() });
    }
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    const all = await postsOf(w.brief.id);
    expect(all).toHaveLength(created.length);
    expect(all.every((r) => r.post.briefVersion === 2)).toBe(true);
  });
});

describe('channel accounts', () => {
  it('lists accounts without tokens and needs sign-in', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get('/api/v1/channel-accounts').expect(200);
    expect(res.body.total).toBe(3);
    const views = res.body.items.map((i: unknown) => channelAccountViewSchema.parse(i));
    expect(views.find((v: { platform: string }) => v.platform === 'instagram')).toMatchObject({ how: 'auto', oauthPlatform: 'meta' });
    expect(JSON.stringify(res.body)).not.toMatch(/access|token-plain|Enc/);
    await agent.get('/api/v1/channel-accounts?platform=nope').expect(400);
    const { default: request } = await import('supertest');
    await request(app).get('/api/v1/channel-accounts').expect(401);
  });

  it('treats a connected account with no token as not connected', async () => {
    await world();
    await makeChannel({ platform: 'youtube', status: 'connected', withToken: false });
    const admin = await createTestUser({ role: 'admin' });
    const res = await (await loginAgent(app, admin)).get('/api/v1/channel-accounts?platform=youtube').expect(200);
    expect(res.body.items[0]).toMatchObject({ status: 'connected', how: 'not_connected' });
  });

  it('disconnects (editor) with an audit log; members cannot', async () => {
    const w = await world();
    await (await loginAgent(app, w.reviewer)).delete(`/api/v1/channel-accounts/${w.ig}`).expect(403);
    const editor = await loginAgent(app, w.editor);
    await editor.delete('/api/v1/channel-accounts/not-a-uuid').expect(400);
    await editor.delete(`/api/v1/channel-accounts/${w.ig}`).expect(204);
    const [row] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, w.ig));
    expect(row).toMatchObject({ status: 'disconnected', accessTokenEnc: null, allowedActions: [] });
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'channel.disconnect'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.before)).not.toContain('v1.');
  });
});

describe('OAuth start', () => {
  it('needs editor, and reports a missing key as FEATURE_DISABLED', async () => {
    const w = await world();
    await (await loginAgent(app, w.reviewer)).get('/api/v1/integrations/oauth/meta/start').expect(403);
    const editor = await loginAgent(app, w.editor);
    await editor.get('/api/v1/integrations/oauth/tiktok/start').expect(400);
    const res = await editor.get('/api/v1/integrations/oauth/meta/start').expect(503);
    expect(res.body.code).toBe('FEATURE_DISABLED');
    await (await loginAgent(app, w.outsider)).get(`/api/v1/integrations/oauth/meta/start?productId=${w.productId}`).expect(403);
  });
});

/** Published Instagram posts at 20:30 IST, one per week for `weeks` weeks, each measured. */
async function publishedHistory(productId: string, channelId: string, weeks: number) {
  for (let w = 1; w <= weeks; w += 1) {
    const b = await makeBrief({ productId, stage: 'live', channels: ['instagram'] });
    for (const extra of [0, 1]) {
      const at = new Date(Date.now() - w * 7 * 86_400_000);
      at.setUTCHours(15, extra * 20, 0, 0); // 20:30 and 20:50 IST, same day and week
      const [p] = await db
        .insert(posts)
        .values({ briefId: b.id, briefVersion: 1, channelAccountId: channelId, status: 'published', scheduledAt: at, publishedAt: at, audienceTz: 'Asia/Kolkata' })
        .returning({ id: posts.id });
      await db.insert(metricSnapshots).values([
        { postId: p!.id, date: at.toISOString().slice(0, 10), reach: 800, saves: 20 },
        { postId: p!.id, date: new Date(at.getTime() + 86_400_000).toISOString().slice(0, 10), reach: 200, saves: 10 },
      ]);
    }
  }
}

describe('best window from week 5', () => {
  it('uses the learned window after 4 measured weeks, in the summary and for new drafts', async () => {
    const w = await world();
    await db.insert(productSettings).values({ productId: w.productId, timezone: 'Asia/Kolkata' });
    const agent = await loginAgent(app, w.reviewer);

    await publishedHistory(w.productId, w.ig, 3);
    let summary = publishBriefSummarySchema.parse((await agent.get(`/api/v1/publish/briefs/${w.brief.id}`).expect(200)).body);
    expect(summary.bestWindow.rule).toBe('starting');

    await truncateAll();
    const w2 = await world();
    await db.insert(productSettings).values({ productId: w2.productId, timezone: 'Asia/Kolkata' });
    await publishedHistory(w2.productId, w2.ig, 4);
    const agent2 = await loginAgent(app, w2.reviewer);
    summary = publishBriefSummarySchema.parse((await agent2.get(`/api/v1/publish/briefs/${w2.brief.id}`).expect(200)).body);
    expect(summary.bestWindow.rule).toBe('learned');
    expect(summary.bestWindow.windows.find((x) => x.platform === 'instagram')).toMatchObject({
      rule: 'learned',
      startHour: 19,
      endHour: 21,
      valuePer1kReach: 90,
      posts: 8,
    });
    expect(summary.bestWindow.windows.find((x) => x.platform === 'linkedin')).toMatchObject({ rule: 'starting' });
    expect(summary.bestWindow.text).toContain('Instagram 19:00 to 21:00');

    const created = await createDraftPostsForBrief(w2.brief.id, w2.admin.id);
    const ig = created.find((p) => p.platform === 'instagram')!;
    // Aimed 30 minutes into the learned window: 19:30 IST = 14:00 UTC.
    expect(new Date(ig.scheduledAt!).toISOString()).toMatch(/T14:00:00\.000Z$/);
  });
});

describe('publish queue and summary', () => {
  it('lists approved, scheduled and live briefs with counts for members only', async () => {
    const w = await world();
    await createDraftPostsForBrief(w.brief.id, w.admin.id);
    await makeBrief({ productId: w.productId, stage: 'brief' });
    const agent = await loginAgent(app, w.reviewer);
    await agent.get('/api/v1/publish/queue').expect(400);
    const res = await agent.get(`/api/v1/publish/queue?productId=${w.productId}`).expect(200);
    expect(res.body.total).toBe(1);
    const item = publishQueueItemSchema.parse(res.body.items[0]);
    expect(item.counts).toMatchObject({ scheduled: 1, draft: 1, manual_pending: 1 });
    expect(item.nextScheduledAt).not.toBeNull();
    await (await loginAgent(app, w.outsider)).get(`/api/v1/publish/queue?productId=${w.productId}`).expect(403);
  });

  it('returns the summary with the gate state, and 404 for an unknown brief', async () => {
    const w = await world();
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get(`/api/v1/publish/briefs/${w.brief.id}`).expect(200);
    const summary = publishBriefSummarySchema.parse(res.body);
    expect(summary.gate).toEqual({ allowed: true, reason: null, claims: 'approved', brand: 'approved' });
    expect(summary.bestWindow.text).toContain('6 to 9 am or 7 to 10 pm');
    await agent.get('/api/v1/publish/briefs/7c9e6679-7425-40de-944b-e07fc1f90ae7').expect(404);
  });
});

describe('posts', () => {
  async function seeded(opts: { autoSchedule?: boolean } = {}) {
    const w = await world(opts);
    const created = await createDraftPostsForBrief(w.brief.id, w.admin.id);
    const id = (platform: string) => created.find((p) => p.platform === platform)!.id;
    return { ...w, igPost: id('instagram'), liPost: id('linkedin'), waPost: id('whatsapp') };
  }

  it('lists rows of the Publish screen', async () => {
    const w = await seeded();
    const res = await (await loginAgent(app, w.reviewer)).get(`/api/v1/briefs/${w.brief.id}/posts`).expect(200);
    expect(res.body.total).toBe(3);
    const rows = res.body.items.map((i: unknown) => postViewSchema.parse(i));
    expect(rows.map((r: { platform: string; how: string }) => [r.platform, r.how])).toEqual([
      ['instagram', 'auto'],
      ['linkedin', 'needs_approval'],
      ['whatsapp', 'reminder'],
    ]);
  });

  it('edits a post with validation, RBAC and audit', async () => {
    const w = await seeded();
    const editor = await loginAgent(app, w.editor);
    await editor.patch(`/api/v1/posts/${w.igPost}`).send({}).expect(400);
    await editor.patch(`/api/v1/posts/${w.igPost}`).send({ audienceTz: 'Mars/Base' }).expect(400);
    await (await loginAgent(app, w.reviewer)).patch(`/api/v1/posts/${w.igPost}`).send({ caption: 'x' }).expect(403);
    const past = await editor.patch(`/api/v1/posts/${w.igPost}`).send({ scheduledAt: '2020-01-01T00:00:00Z' }).expect(400);
    expect(past.body.code).toBe('VALIDATION_FAILED');
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const res = await editor.patch(`/api/v1/posts/${w.igPost}`).send({ caption: 'New caption', scheduledAt: when, audienceTz: 'Asia/Singapore' }).expect(200);
    expect(postViewSchema.parse(res.body)).toMatchObject({ caption: 'New caption', scheduledAt: when, audienceTz: 'Asia/Singapore' });
    const owner = await loginAgent(app, w.owner);
    await owner.patch(`/api/v1/posts/${w.igPost}`).send({ languages: ['en'] }).expect(200);
    await editor.patch('/api/v1/posts/7c9e6679-7425-40de-944b-e07fc1f90ae7').send({ caption: 'x' }).expect(404);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'post.update'))).toHaveLength(2);
  });

  it('blocks schedule all when a gate is not approved for the current version', async () => {
    const w = await world();
    const blocked = await makeBrief({ productId: w.productId, approved: { brand: false } });
    const editor = await loginAgent(app, w.editor);
    const res = await editor.post(`/api/v1/briefs/${blocked.id}/posts/schedule-all`).expect(422);
    expect(res.body.code).toBe('GATE_NOT_ALLOWED');
    expect(res.body.detail).toContain('brand gate');
  });

  it('schedules all drafts it can, and skips channels that need approval', async () => {
    const w = await seeded({ autoSchedule: false });
    await (await loginAgent(app, w.reviewer)).post(`/api/v1/briefs/${w.brief.id}/posts/schedule-all`).expect(403);
    const res = await (await loginAgent(app, w.owner)).post(`/api/v1/briefs/${w.brief.id}/posts/schedule-all`).expect(200);
    const body = scheduleAllResponseSchema.parse(res.body);
    expect(body.scheduled).toBe(1);
    expect(body.skipped).toEqual([{ postId: w.liPost, reason: 'Needs API approval' }]);
    const ig = body.items.find((p) => p.id === w.igPost)!;
    expect(ig.status).toBe('scheduled');
    expect(new Date(ig.scheduledAt!).getTime()).toBeGreaterThan(Date.now());
    expect(await briefStage(w.brief.id)).toBe('scheduled');
  });

  it('post now: queues an auto post, refuses channels that cannot post', async () => {
    const w = await seeded();
    const editor = await loginAgent(app, w.editor);
    const li = await editor.post(`/api/v1/posts/${w.liPost}/post-now`).expect(422);
    expect(li.body.code).toBe('NEEDS_APPROVAL');
    const wa = await editor.post(`/api/v1/posts/${w.waPost}/post-now`).expect(409);
    expect(wa.body.code).toBe('POST_NOT_EDITABLE');
    const res = await editor.post(`/api/v1/posts/${w.igPost}/post-now`).expect(200);
    expect(res.body.status).toBe('scheduled');
    expect(new Date(res.body.scheduledAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(postPublishJob.send).toHaveBeenCalledWith({ postId: w.igPost }, { singletonKey: `post-${w.igPost}` });
  });

  it('post now is blocked when the post was made for an older version', async () => {
    const w = await seeded();
    await db.update(briefs).set({ version: 2 }).where(eq(briefs.id, w.brief.id));
    const res = await (await loginAgent(app, w.editor)).post(`/api/v1/posts/${w.igPost}/post-now`).expect(422);
    expect(res.body.code).toBe('GATE_NOT_ALLOWED');
  });

  it('retry only works on failed posts', async () => {
    const w = await seeded();
    const editor = await loginAgent(app, w.editor);
    await editor.post(`/api/v1/posts/${w.liPost}/retry`).expect(409);
    await db.update(posts).set({ status: 'failed', error: 'PLATFORM_ERROR: boom' }).where(eq(posts.id, w.igPost));
    const res = await editor.post(`/api/v1/posts/${w.igPost}/retry`).expect(200);
    expect(res.body).toMatchObject({ status: 'scheduled', error: null });
  });

  it('cancel moves scheduled posts back to draft and the brief back to approved', async () => {
    const w = await seeded();
    const editor = await loginAgent(app, w.editor);
    await editor.post(`/api/v1/posts/${w.liPost}/cancel`).expect(409);
    await editor.post(`/api/v1/posts/${w.igPost}/cancel`).expect(200);
    expect(await briefStage(w.brief.id)).toBe('scheduled');
    const res = await editor.post(`/api/v1/posts/${w.waPost}/cancel`).expect(200);
    expect(res.body.status).toBe('draft');
    expect(await briefStage(w.brief.id)).toBe('approved');
  });

  it('marks a WhatsApp post as posted and the brief goes live', async () => {
    const w = await seeded();
    const editor = await loginAgent(app, w.editor);
    await editor.post(`/api/v1/posts/${w.waPost}/mark-posted`).send({ liveUrl: 'not a url' }).expect(400);
    await editor.post(`/api/v1/posts/${w.igPost}/mark-posted`).send({}).expect(409);
    const res = await editor.post(`/api/v1/posts/${w.waPost}/mark-posted`).send({ liveUrl: 'https://whatsapp.com/channel/x' }).expect(200);
    expect(res.body).toMatchObject({ status: 'published', liveUrl: 'https://whatsapp.com/channel/x' });
    expect(await briefStage(w.brief.id)).toBe('live');
  });

  it('returns the tracked link, and NO_MEDIA when a post has no file', async () => {
    const w = await seeded();
    const agent = await loginAgent(app, w.reviewer);
    const res = await agent.get(`/api/v1/posts/${w.igPost}/tracked-link`).expect(200);
    const link = trackedLinkSchema.parse(res.body);
    expect(link.params).toMatchObject({ utm_source: 'instagram', utm_medium: 'reel', utm_content: w.brief.code });
    expect(link.display.startsWith('live.humini.app/?')).toBe(true);
    await db.update(posts).set({ assetId: null }).where(eq(posts.id, w.igPost));
    const none = await agent.get(`/api/v1/posts/${w.igPost}/media-url`).expect(422);
    expect(none.body.code).toBe('NO_MEDIA');
    await (await loginAgent(app, w.outsider)).get(`/api/v1/posts/${w.igPost}/tracked-link`).expect(403);
  });

  it('gives a download link for the file', async () => {
    const w = await seeded();
    const res = await (await loginAgent(app, w.reviewer)).get(`/api/v1/posts/${w.waPost}/media-url`).expect(200);
    expect(res.body.url).toContain('master.mp4');
    expect(res.body.expiresIn).toBeGreaterThan(0);
  });

  it('keeps published posts of old versions out of the edit path', async () => {
    const w = await seeded();
    await db.update(posts).set({ status: 'published', publishedAt: new Date() }).where(and(eq(posts.id, w.igPost)));
    const res = await (await loginAgent(app, w.editor)).patch(`/api/v1/posts/${w.igPost}`).send({ caption: 'x' }).expect(409);
    expect(res.body.code).toBe('POST_NOT_EDITABLE');
  });
});
