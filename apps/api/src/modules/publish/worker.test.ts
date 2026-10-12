/**
 * Worker side of publishing: one post with the fail-safe rule, sweep, reminders, token refresh,
 * and the Instagram private reply used by INSIGHTS. Platform HTTP is mocked with nock.
 */
import { and, eq } from 'drizzle-orm';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { META_GRAPH_VERSION } from '../../connectors/config.js';
import { runtime } from '../../connectors/http.js';
import { db } from '../../db/client.js';
import { auditLogs, briefs, channelAccounts, notifications, posts } from '../../db/schema/index.js';
import { decryptSecret } from '../../lib/crypto.js';
import { addMember, createTestProduct, createTestUser, truncateAll } from '../../../test/helpers.js';
import { postPublishJob, whatsappReminderJob } from './jobs.js';
import { publishPost, refreshExpiringTokens, sendPostReminder, sweepDuePosts } from './service.js';
import { sendInstagramPrivateReply } from './shared.js';
import { makeAsset, makeBrief, makeChannel, setProductOwner } from './test-fixtures.js';

vi.mock('./jobs.js', () => {
  const job = (name: string) => ({ name, send: vi.fn().mockResolvedValue('job-id'), schedule: vi.fn(), work: vi.fn() });
  return {
    postPublishJob: job('post.publish'),
    postSweepJob: job('post.sweep'),
    whatsappReminderJob: job('whatsapp.reminder'),
    tokenRefreshJob: job('channel.token-refresh'),
  };
});

const GRAPH = 'https://graph.facebook.com';
const G = `/${META_GRAPH_VERSION}`;
const saved = { storage: env.storage, meta: env.meta, google: env.google, sleep: runtime.sleep };

beforeAll(() => {
  nock.disableNetConnect();
  runtime.sleep = () => Promise.resolve();
});
afterAll(() => {
  nock.enableNetConnect();
  env.storage = saved.storage;
  env.meta = saved.meta;
  env.google = saved.google;
  runtime.sleep = saved.sleep;
});
beforeEach(async () => {
  await truncateAll();
  nock.cleanAll();
  env.storage = saved.storage;
  env.meta = saved.meta;
  env.google = saved.google;
  vi.mocked(postPublishJob.send).mockClear();
  vi.mocked(whatsappReminderJob.send).mockClear();
});
afterEach(() => {
  expect(nock.pendingMocks()).toEqual([]);
});

/** A due Instagram post on an approved brief, owned by a product owner. */
async function duePost(opts: { channelStatus?: 'connected' | 'error'; briefStage?: 'scheduled' | 'live'; version?: number } = {}) {
  const product = await createTestProduct();
  const owner = await createTestUser({ name: 'Live Owner' });
  await addMember(product.id, owner.id, 'owner');
  await setProductOwner(product.id, owner.id);
  const brief = await makeBrief({ productId: product.id, stage: opts.briefStage ?? 'scheduled', ownerId: owner.id });
  const asset = await makeAsset(brief.id);
  const ch = await makeChannel({ platform: 'instagram', status: opts.channelStatus ?? 'connected', externalAccountId: '1789' });
  const [post] = await db
    .insert(posts)
    .values({
      briefId: brief.id,
      briefVersion: opts.version ?? 1,
      channelAccountId: ch.id,
      assetId: asset.id,
      caption: 'Hook',
      status: 'scheduled',
      scheduledAt: new Date(Date.now() - 1000),
    })
    .returning();
  return { product, owner, brief, channelId: ch.id, postId: post!.id };
}

const asR2 = () => {
  env.storage = { ...saved.storage!, driver: 'r2' };
};

async function row(postId: string) {
  const [p] = await db.select().from(posts).where(eq(posts.id, postId));
  return p!;
}

describe('publishPost', () => {
  it('publishes to Instagram, sets the brief live and clears a channel error', async () => {
    asR2();
    const d = await duePost({ channelStatus: 'error' });
    nock(GRAPH)
      .post(`${G}/1789/media`, (b: Record<string, string>) => b.access_token === 'access-token-plain' && b.media_type === 'REELS')
      .reply(200, { id: 'c1' })
      .get(`${G}/c1`)
      .query(true)
      .reply(200, { status_code: 'FINISHED' })
      .post(`${G}/1789/media_publish`)
      .reply(200, { id: 'm1' })
      .get(`${G}/m1`)
      .query(true)
      .reply(200, { permalink: 'https://www.instagram.com/reel/m1/' });
    await expect(publishPost(d.postId)).resolves.toBe('published');
    expect(await row(d.postId)).toMatchObject({ status: 'published', externalId: 'm1', liveUrl: 'https://www.instagram.com/reel/m1/', attempts: 1, error: null });
    const [b] = await db.select().from(briefs).where(eq(briefs.id, d.brief.id));
    expect(b!.stage).toBe('live');
    const [ch] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, d.channelId));
    expect(ch!.status).toBe('connected');
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'post.publish'))).toHaveLength(1);
    // A second run finds nothing to do (no double post).
    await expect(publishPost(d.postId)).resolves.toBe('skipped');
  });

  it('fails safe on a platform error: failed post, brief back to scheduled, owner told, channel marked', async () => {
    asR2();
    const d = await duePost({ briefStage: 'live' });
    nock(GRAPH).post(`${G}/1789/media`).reply(500, { error: { message: 'Service temporarily unavailable' } });
    await expect(publishPost(d.postId)).resolves.toBe('failed');
    const p = await row(d.postId);
    expect(p.status).toBe('failed');
    expect(p.error).toBe('PLATFORM_ERROR: Instagram: Service temporarily unavailable');
    const [b] = await db.select().from(briefs).where(eq(briefs.id, d.brief.id));
    expect(b!.stage).toBe('scheduled');
    const [ch] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, d.channelId));
    expect(ch).toMatchObject({ status: 'error', lastError: p.error });
    const notes = await db.select().from(notifications).where(eq(notifications.userId, d.owner.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'publish_failed', link: `/publish/${d.brief.id}` });
    // Nothing retries silently.
    expect(postPublishJob.send).not.toHaveBeenCalled();
  });

  it('returns MEDIA_NOT_PUBLIC with local MinIO, without marking the channel as broken', async () => {
    const d = await duePost();
    await expect(publishPost(d.postId)).resolves.toBe('failed');
    expect((await row(d.postId)).error).toMatch(/^MEDIA_NOT_PUBLIC: /);
    const [ch] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, d.channelId));
    expect(ch!.status).toBe('connected');
  });

  it('fails with GATE_NOT_ALLOWED when the post belongs to an old version', async () => {
    asR2();
    const d = await duePost({ version: 1 });
    await db.update(briefs).set({ version: 2 }).where(eq(briefs.id, d.brief.id));
    await publishPost(d.postId);
    expect((await row(d.postId)).error).toMatch(/^GATE_NOT_ALLOWED: /);
  });

  it('fails with NOT_CONNECTED when the token is gone', async () => {
    asR2();
    const d = await duePost();
    await db.update(channelAccounts).set({ accessTokenEnc: null }).where(eq(channelAccounts.id, d.channelId));
    await publishPost(d.postId);
    expect((await row(d.postId)).error).toMatch(/^NOT_CONNECTED: /);
  });

  it('skips posts that are not due or not scheduled', async () => {
    const d = await duePost();
    await db.update(posts).set({ scheduledAt: new Date(Date.now() + 3_600_000) }).where(eq(posts.id, d.postId));
    await expect(publishPost(d.postId)).resolves.toBe('skipped');
    await db.update(posts).set({ status: 'draft' }).where(eq(posts.id, d.postId));
    await expect(publishPost(d.postId)).resolves.toBe('skipped');
  });
});

describe('sweep and reminders', () => {
  it('queues due posts and due reminders once', async () => {
    const d = await duePost();
    const wa = await makeChannel({ platform: 'whatsapp', status: 'manual', withToken: false, actions: [] });
    const [reminder] = await db
      .insert(posts)
      .values({ briefId: d.brief.id, briefVersion: 1, channelAccountId: wa.id, status: 'manual_pending', scheduledAt: new Date(Date.now() - 60_000) })
      .returning();
    await expect(sweepDuePosts()).resolves.toEqual({ publish: 1, reminders: 1 });
    expect(postPublishJob.send).toHaveBeenCalledWith({ postId: d.postId }, { singletonKey: `post-${d.postId}` });
    expect(whatsappReminderJob.send).toHaveBeenCalledWith({ postId: reminder!.id }, { singletonKey: `remind-${reminder!.id}` });

    await expect(sendPostReminder(reminder!.id)).resolves.toBe(true);
    await expect(sendPostReminder(reminder!.id)).resolves.toBe(false);
    const notes = await db.select().from(notifications).where(and(eq(notifications.kind, 'publish_reminder'), eq(notifications.userId, d.owner.id)));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain('by hand');
    // Reminded once: the sweep no longer queues it.
    vi.mocked(whatsappReminderJob.send).mockClear();
    await expect(sweepDuePosts()).resolves.toMatchObject({ reminders: 0 });
  });
});

describe('refreshExpiringTokens', () => {
  it('renews a Google token and warns once about a token it cannot renew', async () => {
    env.google = { clientId: 'gid', clientSecret: 'gsecret' };
    const connector = await createTestUser({ role: 'editor' });
    const soon = new Date(Date.now() + 86_400_000);
    const yt = await makeChannel({ platform: 'youtube', refresh: true, expiresAt: soon });
    const li = await makeChannel({ platform: 'linkedin', expiresAt: soon, connectedById: connector.id });
    nock('https://oauth2.googleapis.com')
      .post('/token', (b: Record<string, string>) => b.grant_type === 'refresh_token' && b.refresh_token === 'refresh-token-plain')
      .reply(200, { access_token: 'new-access', expires_in: 3600 });
    await expect(refreshExpiringTokens()).resolves.toEqual({ refreshed: 1, warned: 1 });
    const [ytRow] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, yt.id));
    expect(decryptSecret(ytRow!.accessTokenEnc!)).toBe('new-access');
    expect(decryptSecret(ytRow!.refreshTokenEnc!)).toBe('refresh-token-plain');
    const [liRow] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, li.id));
    expect(liRow!.lastError).toContain('Reconnect');
    expect(await db.select().from(notifications).where(eq(notifications.userId, connector.id))).toHaveLength(1);
    // Next day: Google is fine for an hour only, so it renews again; LinkedIn is not warned twice.
    nock('https://oauth2.googleapis.com').post('/token').reply(200, { access_token: 'newer', expires_in: 3600 });
    await expect(refreshExpiringTokens()).resolves.toEqual({ refreshed: 1, warned: 0 });
  });
});

describe('sendInstagramPrivateReply', () => {
  it('queues when not connected or not allowed, sends when it can, and never throws', async () => {
    const off = await makeChannel({ platform: 'instagram', withToken: false });
    await expect(sendInstagramPrivateReply({ channelAccountId: off.id, commentId: 'c1', message: 'Hi' })).resolves.toMatchObject({ status: 'queued', reason: 'NOT_CONNECTED' });
    const noDm = await makeChannel({ platform: 'instagram', actions: ['publish', 'comments'] });
    await expect(sendInstagramPrivateReply({ channelAccountId: noDm.id, commentId: 'c1', message: 'Hi' })).resolves.toMatchObject({ status: 'queued', reason: 'NOT_ALLOWED' });

    env.meta = { appId: 'a', appSecret: 's', webhookVerifyToken: 'v' };
    const dm = await makeChannel({ platform: 'instagram', actions: ['publish', 'messages'] });
    nock(GRAPH).post(`${G}/me/messages`).query({ access_token: 'access-token-plain' }).reply(200, { message_id: 'mid-9' });
    await expect(sendInstagramPrivateReply({ channelAccountId: dm.id, commentId: 'c1', message: 'Hi' })).resolves.toEqual({ status: 'sent', externalId: 'mid-9' });
    nock(GRAPH).post(`${G}/me/messages`).query(true).reply(400, { error: { message: 'Comment too old' } });
    await expect(sendInstagramPrivateReply({ channelAccountId: dm.id, commentId: 'c2', message: 'Hi' })).resolves.toMatchObject({
      status: 'queued',
      reason: 'ERROR',
      detail: 'PLATFORM_ERROR: Instagram: Comment too old',
    });
  });
});
