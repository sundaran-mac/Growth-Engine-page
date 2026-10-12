/**
 * SETTINGS API integration tests (Supertest + real Postgres).
 * Run with DATABASE_URL_TEST=.../growth_desk_settings_test.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createProductDocumentResponseSchema,
  nextSlotListSchema,
  productChannelListSchema,
  productDocumentListSchema,
  productSettingsDetailSchema,
  scheduleResponseSchema,
  weeklyRunListSchema,
  weeklyRunSchema,
  type Idea,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  auditLogs,
  briefs,
  channelAccounts,
  notifications,
  postingSlots,
  posts,
  productDocuments,
  productKits,
  productSettings,
  products,
  weeklyRuns,
} from '../../db/schema/index.js';
import { setClaudeClientForTests, type ClaudeClient } from '../../lib/claude.js';
import { startQueue } from '../../lib/queue.js';
import {
  addMember,
  createTestProduct,
  createTestUser,
  loginAgent,
  truncateAll,
  type TestUser,
} from '../../../test/helpers.js';
import { processDocument } from './documents.js';
import { setObjectReaderForTests, setObjectStatForTests } from './object-read.js';
import { setResolverForTests } from './safe-fetch.js';
import { buildProductContext, getProductSettings, nextFreeSlots } from './shared.js';
import {
  enqueueDueRuns,
  executeWeeklyRun,
  failStaleRuns,
  PR_SKIPPED_NO_GITHUB,
  STALE_RUN_ERROR,
  type WeeklyRunDeps,
} from './weekly.js';

const app = createApp();
const mutableEnv = env as { githubToken: string | null };

let owner: TestUser;
let maker: TestUser;
let admin: TestUser;
let outsider: TestUser;
let editor: TestUser;
let productId: string;

beforeAll(async () => {
  await startQueue({ worker: false });
  nock.disableNetConnect();
  nock.enableNetConnect(/localhost|127\.0\.0\.1/);
});

afterAll(() => {
  nock.enableNetConnect();
});

beforeEach(async () => {
  await truncateAll();
  owner = await createTestUser({ role: 'member', name: 'Owner Person' });
  maker = await createTestUser({ role: 'member', name: 'Maker Person' });
  admin = await createTestUser({ role: 'admin', name: 'Admin Person' });
  outsider = await createTestUser({ role: 'member', name: 'Out Sider' });
  editor = await createTestUser({ role: 'editor', name: 'Ed Itor' });
  const p = await createTestProduct({ name: 'Humini Live' });
  productId = p.id;
  await db.update(products).set({ ownerId: owner.id }).where(eq(products.id, productId));
  await addMember(productId, owner.id, 'owner');
  await addMember(productId, maker.id, 'maker');
});

afterEach(() => {
  nock.cleanAll();
  mutableEnv.githubToken = null;
  setClaudeClientForTests(null);
  setObjectReaderForTests(null);
  setObjectStatForTests(null);
  setResolverForTests(null);
});

async function auditActions(): Promise<string[]> {
  return (await db.select({ a: auditLogs.action }).from(auditLogs)).map((r) => r.a);
}

async function makeChannel(
  platform: 'instagram' | 'youtube' | 'linkedin',
  opts: { productId?: string | null } = {},
) {
  const [row] = await db
    .insert(channelAccounts)
    .values({
      platform,
      displayName: `${platform} account`,
      status: 'connected',
      externalAccountId: randomUUID(),
      productId: opts.productId === undefined ? null : opts.productId,
    })
    .returning({ id: channelAccounts.id });
  return row!.id;
}

let codeSeq = 100;
async function makePost(
  channelAccountId: string,
  scheduledAt: Date,
  status: 'scheduled' | 'published' | 'draft' = 'scheduled',
  forProduct = productId,
) {
  codeSeq += 1;
  const [b] = await db
    .insert(briefs)
    .values({
      code: `REEL-${codeSeq}`,
      productId: forProduct,
      title: `Brief ${codeSeq}`,
      mode: 'M1',
    })
    .returning({ id: briefs.id });
  const [p] = await db
    .insert(posts)
    .values({
      briefId: b!.id,
      briefVersion: 1,
      channelAccountId,
      scheduledAt,
      status,
      ...(status === 'published' ? { publishedAt: scheduledAt } : {}),
    })
    .returning({ id: posts.id });
  return p!.id;
}

function fakeClaude(text: string): ClaudeClient {
  return {
    beta: {
      messages: {
        create: async () => ({
          content: [{ type: 'text', text }],
          usage: { input_tokens: 100, output_tokens: 50 },
          model: 'test-model',
          stop_reason: 'end_turn',
        }),
      },
    },
  } as unknown as ClaudeClient;
}

/* ---------------------------------------------------------------- settings */

describe('GET/PATCH /products/:productId/settings', () => {
  it('creates default settings on first read and reports features and canEdit', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent.get(`/api/v1/products/${productId}/settings`).expect(200);
    const body = productSettingsDetailSchema.parse(res.body);
    expect(body).toMatchObject({
      productId,
      weeklyRunDay: 1,
      weeklyRunTime: '07:00',
      weeklyIdeasCount: 10,
      autoSchedule: true,
      canEdit: true,
      features: { github: false },
    });
    expect(body.claudeUsage.usedTokens).toBe(0);
  });

  it('lets readers read but not edit', async () => {
    const makerAgent = await loginAgent(app, maker);
    const res = await makerAgent.get(`/api/v1/products/${productId}/settings`).expect(200);
    expect(res.body.canEdit).toBe(false);
    const denied = await makerAgent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ autoSchedule: false })
      .expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect(denied.headers['content-type']).toContain('application/problem+json');
    const editorAgent = await loginAgent(app, editor);
    await editorAgent.get(`/api/v1/products/${productId}/settings`).expect(200);
    await editorAgent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ autoSchedule: false })
      .expect(403);
  });

  it('refuses people outside the product and anonymous calls', async () => {
    const agent = await loginAgent(app, outsider);
    await agent.get(`/api/v1/products/${productId}/settings`).expect(403);
    const anon = await (
      await import('supertest')
    )
      .default(app)
      .get(`/api/v1/products/${productId}/settings`)
      .expect(401);
    expect(anon.body.code).toBe('UNAUTHENTICATED');
  });

  it('404 for an unknown product, 400 for a bad id', async () => {
    const agent = await loginAgent(app, admin);
    await agent.get(`/api/v1/products/${randomUUID()}/settings`).expect(404);
    const bad = await agent.get('/api/v1/products/not-a-uuid/settings').expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
  });

  it('updates fields, writes the audit log', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({
        timezone: 'Asia/Singapore',
        launchDate: '2026-11-01',
        weeklyRunDay: 2,
        weeklyRunTime: '08:30',
        weeklyModes: ['M1', 'M3'],
        githubRepo: 'humini-ecosystem/humini-live-app',
        weeklyPrEnabled: true,
        utmCampaignPrefix: 'live',
        trackingBaseUrl: 'https://live.humini.app',
        claudeMonthlyTokenCap: 500000,
        approvalSlaHours: 12,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      timezone: 'Asia/Singapore',
      launchDate: '2026-11-01',
      weeklyRunTime: '08:30',
      weeklyModes: ['M1', 'M3'],
      weeklyPrEnabled: true,
      claudeUsage: { capTokens: 500000 },
    });
    expect(await auditActions()).toContain('settings.update');
  });

  it('admin can edit without a membership', async () => {
    const agent = await loginAgent(app, admin);
    await agent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ autoSchedule: false })
      .expect(200);
  });

  it('rejects bad values with field errors', async () => {
    const agent = await loginAgent(app, owner);
    const cases: Record<string, unknown>[] = [
      { timezone: 'Mars/Base' },
      { weeklyRunDay: 7 },
      { weeklyRunTime: '25:00' },
      { weeklyIdeasCount: 0 },
      { weeklyModes: ['M9'] },
      { githubRepo: 'not a repo' },
      { trackingBaseUrl: 'javascript:alert(1)' },
      { utmCampaignPrefix: 'Has Spaces' },
      { unknownField: true },
      {},
    ];
    for (const body of cases) {
      const res = await agent
        .patch(`/api/v1/products/${productId}/settings`)
        .send(body)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('refuses weekly PRs without a repo', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ weeklyPrEnabled: true })
      .expect(400);
    expect(res.body.errors[0].path).toBe('githubRepo');
  });
});

/* ---------------------------------------------------------------- slots */

describe('posting slots', () => {
  const slots = [
    {
      platform: 'instagram',
      weekday: 4,
      localTime: '19:30',
      audienceTimezone: 'Asia/Kolkata',
      label: 'India evening',
    },
    {
      platform: 'instagram',
      weekday: 4,
      localTime: '20:00',
      audienceTimezone: 'Asia/Singapore',
      label: 'Singapore evening',
    },
    {
      platform: 'youtube',
      weekday: 0,
      localTime: '09:00',
      audienceTimezone: 'Asia/Dubai',
      active: false,
    },
  ];

  it('replaces and lists slots in order, owner only', async () => {
    const agent = await loginAgent(app, owner);
    const put = await agent.put(`/api/v1/products/${productId}/slots`).send({ slots }).expect(200);
    expect(put.body.total).toBe(3);
    expect(put.body.items.map((s: { sort: number }) => s.sort)).toEqual([0, 1, 2]);
    expect(put.body.items[2]).toMatchObject({ active: false, localTime: '09:00', label: null });
    const list = await (
      await loginAgent(app, maker)
    )
      .get(`/api/v1/products/${productId}/slots`)
      .expect(200);
    expect(list.body.items.map((s: { localTime: string }) => s.localTime)).toEqual([
      '19:30',
      '20:00',
      '09:00',
    ]);
    await (
      await loginAgent(app, maker)
    )
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots })
      .expect(403);
    // Replace with an empty list removes all.
    await agent.put(`/api/v1/products/${productId}/slots`).send({ slots: [] }).expect(200);
    expect(await db.select().from(postingSlots)).toHaveLength(0);
    expect((await auditActions()).filter((a) => a === 'slots.replace')).toHaveLength(2);
  });

  it('rejects duplicates and bad slots', async () => {
    const agent = await loginAgent(app, owner);
    const dup = await agent
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots: [slots[0], slots[0]] })
      .expect(400);
    expect(dup.body.errors[0].message).toContain('twice');
    await agent
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots: [{ ...slots[0], audienceTimezone: 'Nowhere/City' }] })
      .expect(400);
    await agent
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots: [{ ...slots[0], platform: 'tiktok' }] })
      .expect(400);
  });

  it('next slots skip taken posts and anything before the launch date', async () => {
    const agent = await loginAgent(app, owner);
    await agent.put(`/api/v1/products/${productId}/slots`).send({ slots }).expect(200);
    const ig = await makeChannel('instagram');
    // Launch on Thursday 15 Oct 2026 (Kolkata). The 19:30 IST slot that day = 14:00 UTC.
    await agent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ launchDate: '2026-10-15' })
      .expect(200);
    await makePost(ig, new Date('2026-10-15T14:00:00Z'));
    // A draft does not take a slot.
    await makePost(ig, new Date('2026-10-15T12:00:00Z'), 'draft');

    const res = await agent
      .get(`/api/v1/products/${productId}/slots/next`)
      .query({ platform: 'instagram', count: 3, from: '2026-10-01T00:00:00.000Z' })
      .expect(200);
    const body = nextSlotListSchema.parse(res.body);
    expect(body.launchDate).toBe('2026-10-15');
    expect(body.items.map((s) => s.at)).toEqual([
      '2026-10-15T12:00:00.000Z', // 20:00 SGT, not taken (the post there is a draft)
      '2026-10-22T12:00:00.000Z',
      '2026-10-22T14:00:00.000Z',
    ]);

    // The shared function gives the same answer.
    const shared = await nextFreeSlots(productId, 'instagram', new Date('2026-10-01T00:00:00Z'), 2);
    expect(shared.map((s) => s.at.toISOString())).toEqual([
      '2026-10-15T12:00:00.000Z',
      '2026-10-22T12:00:00.000Z',
    ]);
    expect(shared[0]).toHaveProperty('slotId');

    // Inactive slots never show; youtube has only an inactive slot.
    const yt = await agent
      .get(`/api/v1/products/${productId}/slots/next`)
      .query({ platform: 'youtube' })
      .expect(200);
    expect(yt.body.items).toEqual([]);
  });

  it('a post of another product does not take the slot', async () => {
    const agent = await loginAgent(app, owner);
    await agent
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots: [slots[0]] })
      .expect(200);
    const other = await createTestProduct();
    const ig = await makeChannel('instagram');
    await makePost(ig, new Date('2026-10-15T14:00:00Z'), 'scheduled', other.id);
    const found = await nextFreeSlots(productId, 'instagram', new Date('2026-10-12T00:00:00Z'), 1);
    expect(found[0]!.at.toISOString()).toBe('2026-10-15T14:00:00.000Z');
  });

  it('next slots without a platform merges all platforms; validates count', async () => {
    const agent = await loginAgent(app, owner);
    await agent
      .put(`/api/v1/products/${productId}/slots`)
      .send({ slots: [slots[0], { ...slots[2], active: true }] })
      .expect(200);
    const res = await agent
      .get(`/api/v1/products/${productId}/slots/next`)
      .query({ count: 10, from: '2026-10-12T00:00:00.000Z' })
      .expect(200);
    expect(res.body.items).toHaveLength(10);
    const times = res.body.items.map((s: { at: string }) => Date.parse(s.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(res.body.items.map((s: { platform: string }) => s.platform))).toEqual(
      new Set(['instagram', 'youtube']),
    );
    await agent.get(`/api/v1/products/${productId}/slots/next`).query({ count: 0 }).expect(400);
    await agent.get(`/api/v1/products/${productId}/slots/next`).query({ count: 51 }).expect(400);
    await (
      await loginAgent(app, outsider)
    )
      .get(`/api/v1/products/${productId}/slots/next`)
      .expect(403);
  });

  it('getProductSettings returns the view other modules use', async () => {
    const view = await getProductSettings(productId);
    expect(view).toMatchObject({
      productId,
      autoSchedule: true,
      approvalSlaHours: 24,
      launchDate: null,
    });
  });
});

/* ---------------------------------------------------------------- channels */

describe('product channels', () => {
  it('lists shared and own accounts with defaults, and replaces choices', async () => {
    const shared = await makeChannel('instagram');
    const own = await makeChannel('youtube', { productId });
    const other = await createTestProduct();
    const foreign = await makeChannel('linkedin', { productId: other.id });

    const agent = await loginAgent(app, owner);
    const list = productChannelListSchema.parse(
      (await agent.get(`/api/v1/products/${productId}/channels`).expect(200)).body,
    );
    expect(list.items.map((c) => c.channelAccountId).sort()).toEqual([shared, own].sort());
    expect(list.items.every((c) => !c.configured && !c.enabled)).toBe(true);

    const put = await agent
      .put(`/api/v1/products/${productId}/channels`)
      .send({
        channels: [
          {
            channelAccountId: shared,
            enabled: true,
            defaultLanguages: ['en', 'ta'],
            defaultRatio: '9:16',
          },
          { channelAccountId: own, enabled: false, defaultLanguages: [], defaultRatio: null },
        ],
      })
      .expect(200);
    const ig = put.body.items.find(
      (c: { channelAccountId: string }) => c.channelAccountId === shared,
    );
    expect(ig).toMatchObject({
      enabled: true,
      configured: true,
      defaultLanguages: ['en', 'ta'],
      defaultRatio: '9:16',
      shared: true,
    });

    const bad = await agent
      .put(`/api/v1/products/${productId}/channels`)
      .send({
        channels: [
          { channelAccountId: foreign, enabled: true, defaultLanguages: [], defaultRatio: null },
        ],
      })
      .expect(400);
    expect(bad.body.errors[0].path).toBe('channels.0.channelAccountId');
    await agent
      .put(`/api/v1/products/${productId}/channels`)
      .send({
        channels: [
          { channelAccountId: shared, enabled: true, defaultLanguages: ['fr'], defaultRatio: null },
        ],
      })
      .expect(400);
    await (
      await loginAgent(app, maker)
    )
      .put(`/api/v1/products/${productId}/channels`)
      .send({ channels: [] })
      .expect(403);
    expect(await auditActions()).toContain('channels.replace');
  });
});

/* ---------------------------------------------------------------- documents */

describe('knowledge documents', () => {
  it('adds a note, processes it with a Claude summary, and lists it', async () => {
    setClaudeClientForTests(fakeClaude('A short summary of the brand line.'));
    const agent = await loginAgent(app, owner);
    const res = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({
        kind: 'note',
        title: 'Brand line',
        text: 'Every piece ends on the brand line.',
        pinned: true,
      })
      .expect(201);
    const out = createProductDocumentResponseSchema.parse(res.body);
    expect(out.upload).toBeNull();
    expect(out.document).toMatchObject({ kind: 'note', status: 'processing', pinned: true });
    expect(out.document.uploadedBy?.name).toBe('Owner Person');

    await processDocument(out.document.id);
    const list = productDocumentListSchema.parse(
      (await agent.get(`/api/v1/products/${productId}/documents`).expect(200)).body,
    );
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({
      status: 'ready',
      summary: 'A short summary of the brand line.',
      error: null,
    });
    expect(JSON.stringify(list.items[0])).not.toContain('extractedText');
  });

  it('marks a summary as skipped when Claude is not connected', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'note', title: 'N', text: 'Some text.' })
      .expect(201);
    await processDocument(res.body.document.id);
    const [row] = await db.select().from(productDocuments);
    expect(row).toMatchObject({
      status: 'ready',
      summary: null,
      error: 'Summary skipped: Claude is not connected.',
    });
  });

  it('uploads a file: presigned PUT, complete, process from storage', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'file', fileName: 'Spec 006.md', mimeType: 'text/markdown', sizeBytes: 40 })
      .expect(201);
    const out = createProductDocumentResponseSchema.parse(res.body);
    expect(out.upload).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
    });
    expect(out.document).toMatchObject({ status: 'uploading', title: 'Spec 006' });
    expect(out.document.storageKey).toMatch(
      new RegExp(`^products/${productId}/documents/.+-spec-006\\.md$`),
    );

    setObjectStatForTests(async () => null);
    const missing = await agent.post(`/api/v1/documents/${out.document.id}/complete`).expect(422);
    expect(missing.body.code).toBe('UPLOAD_MISSING');

    setObjectStatForTests(async () => ({ sizeBytes: 40, contentType: 'text/markdown' }));
    await (
      await loginAgent(app, maker)
    )
      .post(`/api/v1/documents/${out.document.id}/complete`)
      .expect(403);
    const done = await agent.post(`/api/v1/documents/${out.document.id}/complete`).expect(200);
    expect(done.body.status).toBe('processing');
    const again = await agent.post(`/api/v1/documents/${out.document.id}/complete`).expect(409);
    expect(again.body.code).toBe('DOCUMENT_ALREADY_COMPLETE');

    setObjectReaderForTests(async () => Buffer.from('# Hearts\n\nHearts are counted, not named.'));
    await processDocument(out.document.id);
    const [row] = await db.select().from(productDocuments);
    expect(row).toMatchObject({
      status: 'ready',
      extractedText: '# Hearts\n\nHearts are counted, not named.',
    });
    expect(row!.tokenEstimate).toBeGreaterThan(0);
  });

  it('a file that cannot be read becomes failed with the reason', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'file', fileName: 'deck.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(201);
    setObjectStatForTests(async () => ({ sizeBytes: 10, contentType: 'application/pdf' }));
    await agent.post(`/api/v1/documents/${res.body.document.id}/complete`).expect(200);
    setObjectReaderForTests(async () => Buffer.from('not a pdf'));
    await processDocument(res.body.document.id);
    const [row] = await db.select().from(productDocuments);
    expect(row).toMatchObject({
      status: 'failed',
      error: 'The text could not be read from this file.',
    });
    // Reprocess puts it back in the queue.
    const re = await agent.post(`/api/v1/documents/${res.body.document.id}/reprocess`).expect(200);
    expect(re.body.status).toBe('processing');
    const busy = await agent
      .post(`/api/v1/documents/${res.body.document.id}/reprocess`)
      .expect(409);
    expect(busy.body.code).toBe('DOCUMENT_PROCESSING');
  });

  it('adds a URL, fetches it through the SSRF guard, and blocks private hosts', async () => {
    const agent = await loginAgent(app, owner);
    setResolverForTests(async (host) =>
      host === 'intranet.example.com'
        ? [{ address: '10.0.0.8', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );
    nock('https://live.example.com')
      .get('/about')
      .reply(200, '<html><body><h1>Live</h1><p>Be there for your people.</p></body></html>', {
        'Content-Type': 'text/html',
      });
    const ok = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'url', url: 'https://live.example.com/about' })
      .expect(201);
    expect(ok.body.document).toMatchObject({
      kind: 'url',
      title: 'live.example.com/about',
      status: 'processing',
    });
    await processDocument(ok.body.document.id);

    const blocked = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'url', url: 'http://intranet.example.com/hr' })
      .expect(201);
    await processDocument(blocked.body.document.id);

    const rows = await db.select().from(productDocuments);
    const good = rows.find((r) => r.id === ok.body.document.id)!;
    expect(good.status).toBe('ready');
    expect(good.extractedText).toContain('Be there for your people.');
    const bad = rows.find((r) => r.id === blocked.body.document.id)!;
    expect(bad).toMatchObject({
      status: 'failed',
      error: 'This address points to a private network.',
    });

    await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'url', url: 'ftp://x.example.com' })
      .expect(400);
  });

  it('validates document input and roles', async () => {
    const agent = await loginAgent(app, owner);
    const bad = [
      { kind: 'file', fileName: 'a.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 },
      { kind: 'file', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 21 * 1024 * 1024 },
      { kind: 'note', title: '', text: 'x' },
      { kind: 'repo_spec', title: 'x' },
      { kind: 'note', title: 'x', text: 'y', extra: 1 },
    ];
    for (const body of bad)
      await agent.post(`/api/v1/products/${productId}/documents`).send(body).expect(400);
    await (
      await loginAgent(app, maker)
    )
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'note', title: 'x', text: 'y' })
      .expect(403);
    await (
      await loginAgent(app, outsider)
    )
      .get(`/api/v1/products/${productId}/documents`)
      .expect(403);
  });

  it('pins, renames and deletes; 404 for unknown documents', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent
      .post(`/api/v1/products/${productId}/documents`)
      .send({ kind: 'note', title: 'Old', text: 'Text.' })
      .expect(201);
    const id = res.body.document.id as string;
    const patched = await agent
      .patch(`/api/v1/documents/${id}`)
      .send({ title: 'New', pinned: true })
      .expect(200);
    expect(patched.body).toMatchObject({ title: 'New', pinned: true });
    await agent.patch(`/api/v1/documents/${id}`).send({}).expect(400);
    await (await loginAgent(app, maker)).delete(`/api/v1/documents/${id}`).expect(403);
    await agent.delete(`/api/v1/documents/${id}`).expect(204);
    await agent.delete(`/api/v1/documents/${id}`).expect(404);
    await agent.patch(`/api/v1/documents/${randomUUID()}`).send({ pinned: false }).expect(404);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['document.create', 'document.update', 'document.delete']),
    );
  });

  it('syncs repo specs from GitHub; refuses without a token or repo', async () => {
    const agent = await loginAgent(app, owner);
    const noToken = await agent
      .post(`/api/v1/products/${productId}/documents/sync-repo`)
      .expect(503);
    expect(noToken.body.code).toBe('FEATURE_DISABLED');
    mutableEnv.githubToken = 'test-token';
    const noRepo = await agent
      .post(`/api/v1/products/${productId}/documents/sync-repo`)
      .expect(422);
    expect(noRepo.body.code).toBe('REPO_NOT_SET');

    await agent
      .patch(`/api/v1/products/${productId}/settings`)
      .send({ githubRepo: 'acme/live' })
      .expect(200);
    const gh = nock('https://api.github.com', {
      reqheaders: { authorization: 'Bearer test-token' },
    });
    gh.get('/repos/acme/live/git/trees/main')
      .query({ recursive: '1' })
      .reply(200, {
        tree: [
          { path: 'docs/specs/006.md', type: 'blob', sha: 'a' },
          { path: 'docs/specs/sub/007.md', type: 'blob', sha: 'b' },
          { path: 'docs/other.md', type: 'blob', sha: 'c' },
          { path: 'docs/specs/img.png', type: 'blob', sha: 'd' },
        ],
      });
    gh.get('/repos/acme/live/contents/docs/specs/006.md')
      .query({ ref: 'main' })
      .reply(200, '# 006\nHearts are counted.');
    gh.get('/repos/acme/live/contents/docs/specs/sub/007.md')
      .query({ ref: 'main' })
      .reply(200, '# 007\nCalls ring.');
    const first = await agent.post(`/api/v1/products/${productId}/documents/sync-repo`).expect(200);
    expect(first.body).toEqual({ added: 2, updated: 0, unchanged: 0 });

    gh.get('/repos/acme/live/git/trees/main')
      .query({ recursive: '1' })
      .reply(200, {
        tree: [
          { path: 'docs/specs/006.md', type: 'blob', sha: 'a' },
          { path: 'docs/specs/sub/007.md', type: 'blob', sha: 'b2' },
        ],
      });
    gh.get('/repos/acme/live/contents/docs/specs/006.md')
      .query({ ref: 'main' })
      .reply(200, '# 006\nHearts are counted.');
    gh.get('/repos/acme/live/contents/docs/specs/sub/007.md')
      .query({ ref: 'main' })
      .reply(200, '# 007\nCalls ring, audio first.');
    const second = await agent
      .post(`/api/v1/products/${productId}/documents/sync-repo`)
      .expect(200);
    expect(second.body).toEqual({ added: 0, updated: 1, unchanged: 1 });
    const rows = await db
      .select()
      .from(productDocuments)
      .where(eq(productDocuments.kind, 'repo_spec'));
    expect(rows.map((r) => r.title).sort()).toEqual(['Spec 006', 'Spec sub/007']);
    expect(
      rows.every((r) =>
        r.sourceUrl?.startsWith('https://github.com/acme/live/blob/main/docs/specs/'),
      ),
    ).toBe(true);
  });
});

/* ---------------------------------------------------------------- context */

describe('buildProductContext', () => {
  it('uses the newest kit, pinned text and other summaries', async () => {
    await db.insert(productKits).values([
      { productId, version: 1, promise: 'Old promise' },
      { productId, version: 2, promise: 'Be there for your people.', neverSay: ['spy'] },
    ]);
    await db.insert(productDocuments).values([
      {
        productId,
        title: 'Pinned',
        kind: 'note',
        status: 'ready',
        extractedText: 'Pinned full text.',
        summary: 'p sum',
        pinned: true,
      },
      {
        productId,
        title: 'Other',
        kind: 'note',
        status: 'ready',
        extractedText: 'Other full text.',
        summary: 'Other summary.',
      },
      {
        productId,
        title: 'Busy',
        kind: 'note',
        status: 'processing',
        extractedText: 'Not ready.',
        summary: 'x',
        pinned: true,
      },
    ]);
    const ctx = await buildProductContext(productId);
    expect(ctx.text).toContain('Promise: Be there for your people.');
    expect(ctx.text).not.toContain('Old promise');
    expect(ctx.text).toContain('Pinned full text.');
    expect(ctx.text).toContain('- Other: Other summary.');
    expect(ctx.text).not.toContain('Other full text.');
    expect(ctx.text).not.toContain('Not ready.');
    expect(ctx.documentIds).toHaveLength(2);
    expect(ctx.tokenEstimate).toBeGreaterThan(0);
    const small = await buildProductContext(productId, { maxTokens: 20 });
    expect(small.tokenEstimate).toBeLessThanOrEqual(22);
  });
});

/* ---------------------------------------------------------------- weekly runs */

function makeIdea(title: string, fitScore: number): Idea {
  return {
    id: randomUUID(),
    productId,
    title,
    summary: null,
    mode: 'M1',
    channels: [],
    fitScore,
    status: 'new',
    source: 'claude',
    note: null,
    angle: null,
    briefId: null,
    briefCode: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function deps(over: Partial<WeeklyRunDeps> = {}): WeeklyRunDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    generateIdeas: async (pid, opts) => {
      calls.push(`ideas:${pid === productId}:${opts.count}:${opts.source}`);
      return [makeIdea('Why I build', 88), makeIdea('Two hearts', 70)];
    },
    reviewIdeas: async () => {
      calls.push('review');
      return { rescored: 3, flaggedStale: 1 };
    },
    writeMondayNote: async (pid, weekStart) => {
      calls.push(`note:${weekStart}`);
      return {
        id: randomUUID(),
        productId: pid,
        weekStart,
        doMore: 'Founder films',
        stop: 'Long posters',
        summary: 'Saves up.',
      };
    },
    claudeEnabled: () => true,
    githubEnabled: () => mutableEnv.githubToken !== null,
    createPullRequest: (async () => {
      throw new Error('not expected');
    }) as WeeklyRunDeps['createPullRequest'],
    now: () => new Date('2026-10-12T02:00:00Z'),
    ...over,
  };
}

async function insertRun(over: Partial<typeof weeklyRuns.$inferInsert> = {}) {
  const [row] = await db
    .insert(weeklyRuns)
    .values({ productId, weekStart: '2026-10-12', triggeredBy: 'schedule', ...over })
    .returning();
  return row!;
}

describe('weekly runs', () => {
  it('Run now queues a manual run, refuses a second one, and lists history', async () => {
    const agent = await loginAgent(app, owner);
    const res = await agent.post(`/api/v1/products/${productId}/weekly-runs`).expect(202);
    const run = weeklyRunSchema.parse(res.body);
    expect(run).toMatchObject({
      status: 'queued',
      triggeredBy: 'manual',
      triggeredByUser: { name: 'Owner Person' },
    });
    const again = await agent.post(`/api/v1/products/${productId}/weekly-runs`).expect(409);
    expect(again.body.code).toBe('RUN_IN_PROGRESS');
    await (
      await loginAgent(app, maker)
    )
      .post(`/api/v1/products/${productId}/weekly-runs`)
      .expect(403);
    const list = weeklyRunListSchema.parse(
      (
        await (
          await loginAgent(app, maker)
        )
          .get(`/api/v1/products/${productId}/weekly-runs`)
          .expect(200)
      ).body,
    );
    expect(list.total).toBe(1);
    await agent.get(`/api/v1/products/${productId}/weekly-runs`).query({ limit: 500 }).expect(400);
    expect(await auditActions()).toContain('weekly_run.start');
  });

  it('runs every step, records ideas, and says PR skipped when GitHub is not connected', async () => {
    await db
      .insert(productSettings)
      .values({ productId, githubRepo: 'acme/live', weeklyPrEnabled: true, weeklyIdeasCount: 5 });
    const run = await insertRun();
    const d = deps({
      writeMondayNote: async (pid, weekStart) => ({
        id: await realNoteId(pid, weekStart),
        productId: pid,
        weekStart,
        doMore: 'a',
        stop: 'b',
        summary: 'c',
      }),
    });
    await executeWeeklyRun(run.id, d);
    const [after] = await db.select().from(weeklyRuns).where(eq(weeklyRuns.id, run.id));
    expect(after).toMatchObject({
      status: 'done',
      ideasCreated: 2,
      githubPrUrl: null,
      error: PR_SKIPPED_NO_GITHUB,
    });
    expect(after!.noteId).not.toBeNull();
    expect(after!.startedAt).not.toBeNull();
    expect(after!.finishedAt).not.toBeNull();
    expect(d.calls[0]).toBe('ideas:true:5:weekly');
    const notes = await db.select().from(notifications);
    expect(notes.map((n) => n.userId).sort()).toEqual([owner.id, maker.id].sort());
    // A second call does nothing (only a queued run starts).
    await executeWeeklyRun(run.id, d);
    expect(await db.select().from(notifications)).toHaveLength(2);
  });

  it('opens a GitHub pull request, with a suffix when the branch exists', async () => {
    mutableEnv.githubToken = 'test-token';
    await db
      .insert(productSettings)
      .values({ productId, githubRepo: 'acme/live', weeklyPrEnabled: true });
    const run = await insertRun();
    const gh = nock('https://api.github.com', {
      reqheaders: { authorization: 'Bearer test-token' },
    });
    gh.get('/repos/acme/live/git/ref/heads/main').reply(200, { object: { sha: 'base-sha' } });
    gh.post('/repos/acme/live/git/refs', {
      ref: 'refs/heads/growth-weekly-2026-10-12',
      sha: 'base-sha',
    }).reply(422, {
      message: 'Reference already exists',
    });
    gh.post('/repos/acme/live/git/refs', {
      ref: 'refs/heads/growth-weekly-2026-10-12-2',
      sha: 'base-sha',
    }).reply(201, {});
    gh.get('/repos/acme/live/contents/docs/growth/weekly/2026-10-12.md')
      .query({ ref: 'growth-weekly-2026-10-12-2' })
      .reply(404, {});
    let committed = '';
    gh.put(
      '/repos/acme/live/contents/docs/growth/weekly/2026-10-12.md',
      (body: { content: string; branch: string }) => {
        committed = Buffer.from(body.content, 'base64').toString('utf8');
        return body.branch === 'growth-weekly-2026-10-12-2';
      },
    ).reply(201, {});
    gh.post(
      '/repos/acme/live/pulls',
      (body: { head: string; base: string }) =>
        body.head === 'growth-weekly-2026-10-12-2' && body.base === 'main',
    ).reply(201, {
      html_url: 'https://github.com/acme/live/pull/7',
      number: 7,
    });

    const { createWeeklyPullRequest } = await import('./github.js');
    await executeWeeklyRun(
      run.id,
      deps({
        createPullRequest: createWeeklyPullRequest,
        writeMondayNote: async (pid, weekStart) => ({
          id: await realNoteId(pid, weekStart),
          productId: pid,
          weekStart,
          doMore: 'More founder films',
          stop: 'Stop long posters',
          summary: 'Saves went up.',
        }),
      }),
    );
    const [after] = await db.select().from(weeklyRuns).where(eq(weeklyRuns.id, run.id));
    expect(after).toMatchObject({
      status: 'done',
      githubPrUrl: 'https://github.com/acme/live/pull/7',
      error: null,
    });
    expect(committed).toContain('# Growth weekly proposal: Humini Live, week of 2026-10-12');
    expect(committed).toContain('Why I build');
    expect(gh.isDone()).toBe(true);
  });

  it('a failing step marks the run failed and tells the owner', async () => {
    const run = await insertRun({ triggeredBy: 'manual', triggeredByUserId: maker.id });
    await executeWeeklyRun(
      run.id,
      deps({
        reviewIdeas: async () => {
          throw new Error('review broke');
        },
      }),
    );
    const [after] = await db.select().from(weeklyRuns).where(eq(weeklyRuns.id, run.id));
    expect(after).toMatchObject({
      status: 'failed',
      ideasCreated: 2,
      error: 'Failed at review: review broke',
    });
    const notes = await db.select().from(notifications);
    expect(notes.map((n) => n.userId).sort()).toEqual([owner.id, maker.id].sort());
    expect(notes[0]!.kind).toBe('system');
    expect(await auditActions()).toContain('weekly_run.fail');
  });

  it('the sweep fails runs stuck in running for over 60 minutes and frees Run now', async () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const stuck = await insertRun({
      triggeredBy: 'manual',
      triggeredByUserId: maker.id,
      status: 'running',
      startedAt: new Date(now.getTime() - 61 * 60_000),
    });
    const fresh = await insertRun({
      weekStart: '2026-10-05',
      status: 'running',
      startedAt: new Date(now.getTime() - 59 * 60_000),
    });
    const queuedOld = await insertRun({ weekStart: '2026-09-28', status: 'queued' });

    // Run now is refused while the stuck run looks busy.
    const agent = await loginAgent(app, owner);
    await agent.post(`/api/v1/products/${productId}/weekly-runs`).expect(409);

    expect(await failStaleRuns(now)).toEqual([stuck.id]);
    const rows = await db.select().from(weeklyRuns);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(stuck.id)).toMatchObject({ status: 'failed', error: STALE_RUN_ERROR });
    expect(byId.get(stuck.id)!.finishedAt?.toISOString()).toBe(now.toISOString());
    expect(byId.get(fresh.id)!.status).toBe('running');
    expect(byId.get(queuedOld.id)!.status).toBe('queued');

    const notes = await db.select().from(notifications);
    expect(notes.map((n) => n.userId).sort()).toEqual([owner.id, maker.id].sort());
    expect(notes[0]).toMatchObject({ kind: 'system', entityId: stuck.id });
    expect(notes[0]!.body).toContain(STALE_RUN_ERROR);
    expect(await auditActions()).toContain('weekly_run.fail');

    // Idempotent: a second sweep changes nothing.
    expect(await failStaleRuns(now)).toEqual([]);
    expect(await db.select().from(notifications)).toHaveLength(2);

    // Once the other runs finish, Run now starts again.
    await db
      .update(weeklyRuns)
      .set({ status: 'done' })
      .where(eq(weeklyRuns.id, fresh.id));
    await db
      .update(weeklyRuns)
      .set({ status: 'done' })
      .where(eq(weeklyRuns.id, queuedOld.id));
    await agent.post(`/api/v1/products/${productId}/weekly-runs`).expect(202);
  });

  it('skips with a clear status when Claude is not connected', async () => {
    const run = await insertRun();
    const d = deps({ claudeEnabled: () => false });
    await executeWeeklyRun(run.id, d);
    const [after] = await db.select().from(weeklyRuns).where(eq(weeklyRuns.id, run.id));
    expect(after).toMatchObject({ status: 'skipped', error: 'Skipped: Claude is not connected.' });
    expect(d.calls).toEqual([]);
  });

  it('the tick queues due products once per week and skips disabled or not-yet-due ones', async () => {
    const late = await createTestProduct({ name: 'Late' });
    const off = await createTestProduct({ name: 'Off' });
    await db.insert(productSettings).values([
      { productId, timezone: 'Asia/Kolkata', weeklyRunDay: 1, weeklyRunTime: '07:00' },
      { productId: late.id, timezone: 'Asia/Kolkata', weeklyRunDay: 3, weeklyRunTime: '07:00' },
      { productId: off.id, weeklyRunEnabled: false },
    ]);
    const archived = await createTestProduct({ name: 'Old' });
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, archived.id));

    const now = new Date('2026-10-12T02:00:00Z'); // Monday 07:30 IST
    const first = await enqueueDueRuns(now);
    expect(first).toHaveLength(1);
    const second = await enqueueDueRuns(new Date('2026-10-12T02:15:00Z'));
    expect(second).toHaveLength(0);
    const rows = await db.select().from(weeklyRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productId,
      weekStart: '2026-10-12',
      triggeredBy: 'schedule',
      status: 'queued',
    });
    // Settings rows were created for products that had none (archived ones excluded).
    const settingsRows = await db
      .select()
      .from(productSettings)
      .where(and(eq(productSettings.productId, archived.id)));
    expect(settingsRows).toHaveLength(0);
  });
});

/** INSIGHTS owns weekly_notes; tests insert a row so the run's note_id foreign key holds. */
async function realNoteId(pid: string, weekStart: string): Promise<string> {
  const { weeklyNotes } = await import('../../db/schema/index.js');
  const [row] = await db
    .insert(weeklyNotes)
    .values({ productId: pid, weekStart, body: 'note' })
    .onConflictDoNothing()
    .returning({ id: weeklyNotes.id });
  if (row) return row.id;
  const [existing] = await db
    .select({ id: weeklyNotes.id })
    .from(weeklyNotes)
    .where(eq(weeklyNotes.productId, pid));
  return existing!.id;
}

/* ---------------------------------------------------------------- schedule */

describe('GET /schedule', () => {
  it('returns scheduled and published posts in the range plus free slots', async () => {
    const ig = await makeChannel('instagram');
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    await makePost(ig, future, 'scheduled');
    await makePost(ig, past, 'published');
    await makePost(ig, future, 'draft');
    const agent = await loginAgent(app, maker);
    await (
      await loginAgent(app, owner)
    )
      .put(`/api/v1/products/${productId}/slots`)
      .send({
        slots: [
          {
            platform: 'instagram',
            weekday: 4,
            localTime: '19:30',
            audienceTimezone: 'Asia/Kolkata',
          },
        ],
      })
      .expect(200);
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const to = new Date(Date.now() + 21 * 24 * 3600 * 1000).toISOString();
    const res = await agent.get('/api/v1/schedule').query({ productId, from, to }).expect(200);
    const body = scheduleResponseSchema.parse(res.body);
    expect(body.items.map((i) => i.status)).toEqual(['published', 'scheduled']);
    expect(body.items[0]).toMatchObject({
      platform: 'instagram',
      channelName: 'instagram account',
    });
    expect(body.freeSlots.length).toBeGreaterThanOrEqual(2);
    expect(body.freeSlots.every((s) => Date.parse(s.at) >= Date.now() - 60_000)).toBe(true);
    expect(body.timezone).toBe(env.appTimezone);
  });

  it('validates the range and checks access', async () => {
    const agent = await loginAgent(app, owner);
    const from = '2026-10-01T00:00:00.000Z';
    await agent
      .get('/api/v1/schedule')
      .query({ productId, from, to: '2026-09-01T00:00:00.000Z' })
      .expect(400);
    await agent
      .get('/api/v1/schedule')
      .query({ productId, from, to: '2027-01-01T00:00:00.000Z' })
      .expect(400);
    await agent.get('/api/v1/schedule').query({ from, to: '2026-10-08T00:00:00.000Z' }).expect(400);
    await agent
      .get('/api/v1/schedule')
      .query({ productId: randomUUID(), from, to: '2026-10-08T00:00:00.000Z' })
      .expect(404);
    await (
      await loginAgent(app, outsider)
    )
      .get('/api/v1/schedule')
      .query({ productId, from, to: '2026-10-08T00:00:00.000Z' })
      .expect(403);
  });
});
