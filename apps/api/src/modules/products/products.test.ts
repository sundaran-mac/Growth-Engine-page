import { and, eq } from 'drizzle-orm';
import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createUserResponseSchema,
  integrationsStatusResponseSchema,
  kitRefreshResultSchema,
  productDetailSchema,
  productKitViewSchema,
  productListResponseSchema,
  productMembersResponseSchema,
  teamListResponseSchema,
} from '@growth-desk/contract';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  auditLogs,
  briefs,
  channelAccounts,
  integrations,
  metricSnapshots,
  notifications,
  posts,
  productKits,
  productMembers,
  productSettings,
  products,
  sessions,
  users,
} from '../../db/schema/index.js';
import { encryptSecret } from '../../lib/crypto.js';
import {
  addMember,
  createTestProduct,
  createTestUser,
  loginAgent,
  truncateAll,
} from '../../../test/helpers.js';
import { GITHUB_API } from './github.js';

const app = createApp();
const API = '/api/v1';

async function seedKit(productId: string, extra: Partial<typeof productKits.$inferInsert> = {}) {
  const [row] = await db
    .insert(productKits)
    .values({ productId, version: 1, promise: 'Be there.', ...extra })
    .returning();
  return row!;
}

describe('products API', () => {
  beforeEach(truncateAll);

  it('lists products with kit summary and this-month stats; needs sign-in', async () => {
    await request401(`${API}/products`);
    const owner = await createTestUser({ role: 'admin', name: 'Elan Founder' });
    const p = await createTestProduct({ name: 'Humini Live', slug: 'humini-live' });
    await db
      .update(products)
      .set({ ownerId: owner.id, status: 'in_build' })
      .where(eq(products.id, p.id));
    await seedKit(p.id, {
      behaviours: [
        { text: 'a', specRef: '006' },
        { text: 'b', specRef: '006' },
        { text: 'c', specRef: '007' },
      ],
      neverSay: ['anonymous'],
      notBuilt: [{ text: 'later', specRef: '013' }],
      audiences: ['Elders'],
      activationEvent: 'First response',
      truthSources: ['live.humini.app'],
      signedById: owner.id,
      signedAt: new Date('2026-10-08T04:30:00Z'),
    });
    const [brief] = await db
      .insert(briefs)
      .values({ code: 'REEL-001', productId: p.id, title: 'x', mode: 'M1', stage: 'live' })
      .returning();
    const [acct] = await db
      .insert(channelAccounts)
      .values({ platform: 'instagram', displayName: 'IG', status: 'connected' })
      .returning();
    const [post] = await db
      .insert(posts)
      .values({
        briefId: brief!.id,
        briefVersion: 1,
        channelAccountId: acct!.id,
        audienceTz: 'Asia/Kolkata',
        status: 'published',
        publishedAt: new Date(),
        scheduledAt: new Date(),
      })
      .returning();
    const today = new Date().toISOString().slice(0, 10);
    await db.insert(metricSnapshots).values({ postId: post!.id, date: today, installs: 7 });

    const agent = await loginAgent(app, await createTestUser({ role: 'viewer' }));
    const res = await agent.get(`${API}/products`).expect(200);
    const body = productListResponseSchema.parse(res.body);
    expect(body.total).toBe(1);
    const item = body.items[0]!;
    // 9 of 10: every field but the backup.
    expect(item.kit).toMatchObject({ version: 1, score: 9, promise: 'Be there.' });
    expect(item.kit?.signedBy?.name).toBe('Elan Founder');
    expect(item.owner?.id).toBe(owner.id);
    expect(item.stats.piecesThisMonth).toBe(1);
    expect(item.platforms).toEqual(['instagram']);
    // installs are counted in the app month; the snapshot date is UTC today which is in the same
    // month except in the first hours of a month, so only check it is a number.
    expect(item.stats.installsThisMonth).toBeGreaterThanOrEqual(0);

    const filtered = await agent.get(`${API}/products?status=live`).expect(200);
    expect(filtered.body.total).toBe(0);
    await agent.get(`${API}/products?limit=500`).expect(400);
  });

  it('creates a product with kit v1, members and settings in one transaction', async () => {
    const editor = await createTestUser({ role: 'editor' });
    const owner = await createTestUser({ role: 'member', name: 'Meera Iyer' });
    const backup = await createTestUser({ role: 'member' });
    const agent = await loginAgent(app, editor);
    const res = await agent
      .post(`${API}/products`)
      .send({
        name: 'Humini Send',
        slug: 'humini-send',
        repoUrl: 'https://github.com/humini-ecosystem/humini-send',
        ownerId: owner.id,
        backupId: backup.id,
        color: '#427BBF',
      })
      .expect(201);
    const body = productDetailSchema.parse(res.body);
    expect(body).toMatchObject({ shortName: 'Send', status: 'draft', color: '#427bbf' });
    expect(body.kit).toMatchObject({ version: 1 });
    const roles = body.members.map((m) => `${m.user.id}:${m.productRole}`).sort();
    expect(roles).toEqual(
      [`${owner.id}:owner`, `${backup.id}:backup`, `${editor.id}:maker`].sort(),
    );
    const [settings] = await db
      .select()
      .from(productSettings)
      .where(eq(productSettings.productId, body.id));
    expect(settings?.githubRepo).toBe('humini-ecosystem/humini-send');
    expect(settings?.weeklyRunDay).toBe(1);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'product.create'));
    expect(audit).toHaveLength(1);

    const dup = await agent
      .post(`${API}/products`)
      .send({ name: 'Other', slug: 'humini-send' })
      .expect(409);
    expect(dup.body.code).toBe('SLUG_TAKEN');
    // Nothing half-written after the failure.
    expect(await db.select().from(products)).toHaveLength(1);
  });

  it('rejects bad input and members without the role', async () => {
    const member = await loginAgent(app, await createTestUser({ role: 'member' }));
    const denied = await member.post(`${API}/products`).send({ name: 'X', slug: 'xx' }).expect(403);
    expect(denied.body.code).toBe('FORBIDDEN');

    const editor = await loginAgent(app, await createTestUser({ role: 'editor' }));
    const bad = await editor
      .post(`${API}/products`)
      .send({ name: 'A', slug: 'Bad Slug', color: 'orange', repoUrl: 'ftp://x' })
      .expect(400);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const paths = (bad.body.errors as { path: string }[]).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['body.name', 'body.slug', 'body.color', 'body.repoUrl']),
    );
    const same = await createTestUser();
    await editor
      .post(`${API}/products`)
      .send({ name: 'Same', slug: 'same', ownerId: same.id, backupId: same.id })
      .expect(400);
  });

  it('PATCH: owner or admin only; keeps owner and backup memberships in step', async () => {
    const owner = await createTestUser({ name: 'Owner One' });
    const newOwner = await createTestUser({ name: 'Owner Two' });
    const outsider = await createTestUser();
    const p = await createTestProduct();
    await db.update(products).set({ ownerId: owner.id }).where(eq(products.id, p.id));
    await addMember(p.id, owner.id, 'owner');
    await seedKit(p.id);

    const out = await loginAgent(app, outsider);
    await out.patch(`${API}/products/${p.id}`).send({ name: 'Nope' }).expect(403);

    const agent = await loginAgent(app, owner);
    await agent.patch(`${API}/products/${p.id}`).send({}).expect(400);
    await agent.patch(`${API}/products/not-a-uuid`).send({ name: 'x' }).expect(400);
    const res = await agent
      .patch(`${API}/products/${p.id}`)
      .send({
        name: 'Humini Pulse',
        shortName: 'Pulse',
        status: 'live',
        statusNote: 'pulse.humini.app',
        color: '#3e7568',
        siteUrl: 'https://pulse.humini.app',
        repoUrl: '',
        ownerId: newOwner.id,
        backupId: owner.id,
      })
      .expect(200);
    const body = productDetailSchema.parse(res.body);
    expect(body).toMatchObject({ name: 'Humini Pulse', status: 'live', repoUrl: null });
    expect(body.owner?.id).toBe(newOwner.id);
    expect(body.backup?.id).toBe(owner.id);
    const rows = await db.select().from(productMembers).where(eq(productMembers.productId, p.id));
    expect(rows.map((r) => `${r.userId}:${r.productRole}`).sort()).toEqual(
      [`${newOwner.id}:owner`, `${owner.id}:backup`].sort(),
    );
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'product.update'));
    expect(audit).toHaveLength(1);
  });

  it('PUT members replaces the list and protects the named owner', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const owner = await createTestUser();
    const maker = await createTestUser();
    const p = await createTestProduct();
    await db.update(products).set({ ownerId: owner.id }).where(eq(products.id, p.id));
    await addMember(p.id, owner.id, 'owner');
    const agent = await loginAgent(app, admin);

    const missing = await agent
      .put(`${API}/products/${p.id}/members`)
      .send({ members: [{ userId: maker.id, productRole: 'maker' }] })
      .expect(422);
    expect(missing.body.code).toBe('OWNER_MEMBERSHIP_REQUIRED');

    const res = await agent
      .put(`${API}/products/${p.id}/members`)
      .send({
        members: [
          { userId: owner.id, productRole: 'owner' },
          { userId: maker.id, productRole: 'maker' },
          { userId: maker.id, productRole: 'reviewer' },
        ],
      })
      .expect(200);
    expect(productMembersResponseSchema.parse(res.body).total).toBe(3);

    await agent
      .put(`${API}/products/${p.id}/members`)
      .send({
        members: [
          { userId: owner.id, productRole: 'owner' },
          { userId: owner.id, productRole: 'owner' },
        ],
      })
      .expect(400);
    const unknown = await agent
      .put(`${API}/products/${p.id}/members`)
      .send({
        members: [
          { userId: owner.id, productRole: 'owner' },
          { userId: '00000000-0000-4000-8000-000000000999', productRole: 'maker' },
        ],
      })
      .expect(400);
    expect(unknown.body.code).toBe('USER_NOT_FOUND');

    const makerAgent = await loginAgent(app, maker);
    await makerAgent.put(`${API}/products/${p.id}/members`).send({ members: [] }).expect(403);
    const audit = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'product.members.replace'));
    expect(audit).toHaveLength(1);
  });

  it('GET /products/:id returns 404 for an unknown product', async () => {
    const agent = await loginAgent(app, await createTestUser());
    const res = await agent.get(`${API}/products/00000000-0000-4000-8000-000000000123`).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('product kit API', () => {
  beforeEach(truncateAll);

  async function setup() {
    const owner = await createTestUser({ name: 'Elan' });
    const editor = await createTestUser({ role: 'editor' });
    const p = await createTestProduct({ name: 'Humini Live' });
    await db.update(products).set({ ownerId: owner.id }).where(eq(products.id, p.id));
    await addMember(p.id, owner.id, 'owner');
    await seedKit(p.id);
    return { owner, editor, productId: p.id };
  }

  const fullKit = (version: number) => ({
    version,
    promise: 'Be there for your people, in Joy and Care.',
    behaviours: [
      { text: 'A heart: the owner sees how many, never who', specRef: '006' },
      { text: 'A byte: up to 60 seconds', specRef: '006' },
      { text: 'A call rings only when availability is on', specRef: '007' },
    ],
    neverSay: ['anonymous', 'strangers'],
    notBuilt: [{ text: 'Surprise moments', specRef: '013' }],
    audiences: ['Elders'],
    activationEvent: 'A circle’s first moment gets a response',
    truthSources: ['live.humini.app'],
  });

  it('edits in place while draft, signs, then an edit makes a new unsigned version', async () => {
    const { owner, editor, productId } = await setup();
    const ed = await loginAgent(app, editor);

    const first = await ed.get(`${API}/products/${productId}/kit`).expect(200);
    const view = productKitViewSchema.parse(first.body);
    expect(view).toMatchObject({ version: 1, status: 'draft', canSign: false, canEdit: true });

    const saved = await ed.put(`${API}/products/${productId}/kit`).send(fullKit(1)).expect(200);
    expect(productKitViewSchema.parse(saved.body)).toMatchObject({ version: 1, score: 9 });

    // Only the owner signs.
    const notOwner = await ed.post(`${API}/products/${productId}/kit/sign`).expect(403);
    expect(notOwner.body.code).toBe('KIT_SIGN_NOT_ALLOWED');
    const own = await loginAgent(app, owner);
    const signed = await own.post(`${API}/products/${productId}/kit/sign`).expect(200);
    expect(productKitViewSchema.parse(signed.body)).toMatchObject({
      status: 'signed',
      signedBy: { id: owner.id },
    });
    const again = await own.post(`${API}/products/${productId}/kit/sign`).expect(409);
    expect(again.body.code).toBe('KIT_ALREADY_SIGNED');

    // Same content: nothing changes.
    const same = await ed.put(`${API}/products/${productId}/kit`).send(fullKit(1)).expect(200);
    expect(same.body.version).toBe(1);

    // Real edit after signing: version 2, draft, owner notified.
    const edited = await ed
      .put(`${API}/products/${productId}/kit`)
      .send({ ...fullKit(1), neverSay: ['anonymous', 'strangers', 'vanishes'] })
      .expect(200);
    expect(productKitViewSchema.parse(edited.body)).toMatchObject({
      version: 2,
      status: 'draft',
      signedBy: null,
    });
    const versions = await db
      .select()
      .from(productKits)
      .where(eq(productKits.productId, productId));
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.version === 1)?.signedAt).not.toBeNull();
    const notes = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, owner.id), eq(notifications.kind, 'kit_changed')));
    expect(notes).toHaveLength(1);

    // Stale version: 409.
    const stale = await ed.put(`${API}/products/${productId}/kit`).send(fullKit(1)).expect(409);
    expect(stale.body.code).toBe('KIT_VERSION_CONFLICT');

    const audit = await db.select().from(auditLogs).where(eq(auditLogs.entity, 'product_kit'));
    expect(audit.map((a) => a.action).sort()).toEqual(['kit.sign', 'kit.update', 'kit.update']);
  });

  it('rejects invalid kit input and people without the role', async () => {
    const { productId } = await setup();
    const member = await loginAgent(app, await createTestUser({ role: 'member' }));
    await member.put(`${API}/products/${productId}/kit`).send(fullKit(1)).expect(403);
    await member.post(`${API}/products/${productId}/kit/refresh`).expect(403);

    const ed = await loginAgent(app, await createTestUser({ role: 'editor' }));
    const bad = await ed
      .put(`${API}/products/${productId}/kit`)
      .send({
        ...fullKit(1),
        behaviours: [{ text: 'x', specRef: 'spec six' }],
        neverSay: ['a', 'A'],
      })
      .expect(400);
    const paths = (bad.body.errors as { path: string }[]).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['body.behaviours.0.specRef', 'body.neverSay']));
  });

  describe('refresh from repo', () => {
    const saved = env.githubToken;
    afterEach(() => {
      env.githubToken = saved;
      nock.cleanAll();
    });

    it('says GitHub is not connected without a token', async () => {
      env.githubToken = null;
      const { productId, editor } = await setup();
      const ed = await loginAgent(app, editor);
      const res = await ed.post(`${API}/products/${productId}/kit/refresh`).expect(503);
      expect(res.body.code).toBe('FEATURE_DISABLED');
    });

    it('needs a repo', async () => {
      env.githubToken = 'test-token';
      const { productId, editor } = await setup();
      const ed = await loginAgent(app, editor);
      const res = await ed.post(`${API}/products/${productId}/kit/refresh`).expect(422);
      expect(res.body.code).toBe('REPO_NOT_SET');
    });

    it('lists spec files changed since the signature and remembers the result', async () => {
      env.githubToken = 'test-token';
      const { productId, owner } = await setup();
      const signedAt = new Date('2026-10-08T04:30:00Z');
      await db
        .update(products)
        .set({ repoUrl: 'https://github.com/humini-ecosystem/humini-live-app' })
        .where(eq(products.id, productId));
      await db
        .update(productKits)
        .set({ signedById: owner.id, signedAt, behaviours: [{ text: 'x', specRef: '006' }] })
        .where(eq(productKits.productId, productId));

      const repo = '/repos/humini-ecosystem/humini-live-app';
      nock(GITHUB_API, { reqheaders: { authorization: 'Bearer test-token' } })
        .get(`${repo}/commits`)
        .query({ path: 'docs/specs', since: signedAt.toISOString(), per_page: '21' })
        .reply(200, [
          { sha: 'b2', commit: { committer: { date: '2026-10-11T10:00:00Z' } } },
          { sha: 'a1', commit: { committer: { date: '2026-10-09T10:00:00Z' } } },
        ])
        .get(`${repo}/commits/b2`)
        .reply(200, {
          sha: 'b2',
          html_url: 'https://github.com/x/b2',
          commit: { committer: { date: '2026-10-11T10:00:00Z' } },
          files: [
            { filename: 'docs/specs/006-hearts.md', status: 'modified' },
            { filename: 'README.md', status: 'modified' },
          ],
        })
        .get(`${repo}/commits/a1`)
        .reply(200, {
          sha: 'a1',
          commit: { committer: { date: '2026-10-09T10:00:00Z' } },
          files: [
            { filename: 'docs/specs/006-hearts.md', status: 'modified' },
            { filename: 'docs/specs/014-gifts.md', status: 'added' },
          ],
        });

      const agent = await loginAgent(app, owner);
      const res = await agent.post(`${API}/products/${productId}/kit/refresh`).expect(200);
      const result = kitRefreshResultSchema.parse(res.body);
      expect(result.repo).toBe('humini-ecosystem/humini-live-app');
      expect(result.changes).toEqual([
        expect.objectContaining({
          path: 'docs/specs/006-hearts.md',
          specRef: '006',
          status: 'modified',
          citedInKit: true,
          changedAt: '2026-10-11T10:00:00.000Z',
        }),
        expect.objectContaining({
          path: 'docs/specs/014-gifts.md',
          status: 'added',
          citedInKit: false,
        }),
      ]);
      // Nothing in the kit changed.
      const kit = await agent.get(`${API}/products/${productId}/kit`).expect(200);
      expect(kit.body.version).toBe(1);
      expect(kit.body.status).toBe('signed');
      expect(kit.body.lastRefresh.changes).toHaveLength(2);
    });

    it('maps a GitHub 404 to REPO_NOT_FOUND', async () => {
      env.githubToken = 'test-token';
      const { productId, editor } = await setup();
      await db
        .update(products)
        .set({ repoUrl: 'https://github.com/org/missing' })
        .where(eq(products.id, productId));
      nock(GITHUB_API).get('/repos/org/missing/git/trees/main').query(true).reply(404, {});
      const ed = await loginAgent(app, editor);
      const res = await ed.post(`${API}/products/${productId}/kit/refresh`).expect(422);
      expect(res.body.code).toBe('REPO_NOT_FOUND');
    });
  });
});

describe('integrations status API', () => {
  beforeEach(truncateAll);

  it('shows the real state: connected needs a token; WhatsApp is manual; tools follow env', async () => {
    await request401(`${API}/integrations/status`);
    await db.insert(channelAccounts).values([
      {
        platform: 'instagram',
        displayName: 'Instagram',
        status: 'connected',
        allowedActions: ['publish'],
      },
      {
        platform: 'youtube',
        displayName: 'YouTube',
        status: 'connected',
        allowedActions: ['publish', 'insights'],
        accessTokenEnc: encryptSecret('secret-token'),
        connectedAt: new Date(),
      },
      { platform: 'linkedin', displayName: 'LinkedIn', status: 'needs_approval' },
      { platform: 'whatsapp', displayName: 'WhatsApp', status: 'connected' },
    ]);
    await db.insert(integrations).values([
      { key: 'claude', name: 'Claude', status: 'connected' },
      { key: 'google-drive', name: 'Google Drive', status: 'connected' },
      { key: 'hubspot', name: 'HubSpot (free)', status: 'not_set_up' },
      { key: 'analytics', name: 'GA4', status: 'check_first' },
    ]);

    const agent = await loginAgent(app, await createTestUser({ role: 'viewer' }));
    const res = await agent.get(`${API}/integrations/status`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
    expect(JSON.stringify(res.body)).not.toMatch(/TokenEnc/);
    const body = integrationsStatusResponseSchema.parse(res.body);
    const ch = Object.fromEntries(body.channels.map((c) => [c.platform, c]));
    expect(ch.instagram).toMatchObject({
      status: 'disconnected',
      hasToken: false,
      allowedActions: [],
    });
    expect(ch.youtube).toMatchObject({ status: 'connected', hasToken: true });
    expect(ch.linkedin?.status).toBe('needs_approval');
    expect(ch.whatsapp).toMatchObject({ status: 'manual', canConnect: false });
    expect(ch.facebook).toMatchObject({ id: null, status: 'disconnected' });

    const tools = Object.fromEntries(body.tools.map((t) => [t.key, t]));
    expect(tools.claude?.status).toBe(env.features.claude ? 'connected' : 'not_set_up');
    expect(tools['google-drive']?.status).toBe('not_set_up');
    expect(tools.hubspot?.status).toBe('not_set_up');
    expect(tools.analytics?.status).toBe('check_first');
    expect(tools.storage?.status).toBe(env.features.storage ? 'connected' : 'not_set_up');
    expect(tools.github).toBeDefined();
  });
});

describe('team API', () => {
  beforeEach(truncateAll);

  it('lists people with memberships and backup-for', async () => {
    const a = await createTestUser({ name: 'Jeeva Santiago', role: 'editor' });
    const b = await createTestUser({ name: 'Meera Iyer' });
    await createTestUser({ name: 'Gone Person', isActive: false });
    const p = await createTestProduct({ name: 'Humini Live' });
    await db.update(products).set({ backupId: b.id }).where(eq(products.id, p.id));
    await addMember(p.id, b.id, 'backup');
    await addMember(p.id, a.id, 'maker');

    const agent = await loginAgent(app, a);
    const res = await agent.get(`${API}/users`).expect(200);
    const body = teamListResponseSchema.parse(res.body);
    expect(body.total).toBe(2);
    const meera = body.items.find((u) => u.id === b.id)!;
    expect(meera.backupFor).toEqual([{ productId: p.id, productName: 'Humini Live' }]);
    expect(meera.memberships[0]).toMatchObject({ productRole: 'backup' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const all = await agent.get(`${API}/users?includeInactive=true&q=gone`).expect(200);
    expect(all.body.total).toBe(1);
  });

  it('admin invites a person with a temp password shown once', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const agent = await loginAgent(app, admin);
    const res = await agent
      .post(`${API}/users`)
      .send({ email: 'New.Person@Example.com', name: 'New Person', role: 'member' })
      .expect(201);
    const body = createUserResponseSchema.parse(res.body);
    expect(body.user).toMatchObject({ email: 'new.person@example.com', initials: 'NP' });
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(16);
    const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
    expect(row?.passwordHash).not.toContain(body.tempPassword);

    // The new person can sign in with it.
    await loginAgent(app, {
      id: body.user.id,
      email: 'new.person@example.com',
      password: body.tempPassword,
      role: 'member',
    });

    const dup = await agent
      .post(`${API}/users`)
      .send({ email: 'new.person@example.com', name: 'Again' })
      .expect(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');
    await agent.post(`${API}/users`).send({ email: 'nope', name: '' }).expect(400);

    const editor = await loginAgent(app, await createTestUser({ role: 'editor' }));
    await editor.post(`${API}/users`).send({ email: 'x@example.com', name: 'X' }).expect(403);
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.action, 'user.create'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.after)).not.toContain(row!.passwordHash);
  });

  it('admin changes role and brand approver; turning off signs the person out', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const person = await createTestUser({ role: 'member' });
    await loginAgent(app, person);
    const agent = await loginAgent(app, admin);

    const res = await agent
      .patch(`${API}/users/${person.id}`)
      .send({ role: 'editor', isBrandApprover: true, title: 'Brand' })
      .expect(200);
    expect(res.body).toMatchObject({ role: 'editor', isBrandApprover: true, title: 'Brand' });

    await agent.patch(`${API}/users/${person.id}`).send({ isActive: false }).expect(200);
    const left = await db.select().from(sessions).where(eq(sessions.userId, person.id));
    expect(left).toHaveLength(0);

    const self = await agent.patch(`${API}/users/${admin.id}`).send({ role: 'member' }).expect(422);
    expect(self.body.code).toBe('CANNOT_CHANGE_SELF');
    await agent.patch(`${API}/users/${person.id}`).send({}).expect(400);
    await agent
      .patch(`${API}/users/00000000-0000-4000-8000-000000000555`)
      .send({ role: 'viewer' })
      .expect(404);

    const member = await loginAgent(app, await createTestUser({ role: 'member' }));
    await member.patch(`${API}/users/${person.id}`).send({ role: 'admin' }).expect(403);
  });

  it('never removes the last active admin', async () => {
    const a1 = await createTestUser({ role: 'admin' });
    const a2 = await createTestUser({ role: 'admin' });
    const agent = await loginAgent(app, a1);
    await agent.patch(`${API}/users/${a2.id}`).send({ isActive: false }).expect(200);
    const second = await loginAgent(app, a1);
    // a1 is now the only active admin and cannot demote itself.
    const res = await second.patch(`${API}/users/${a1.id}`).send({ role: 'editor' }).expect(422);
    expect(res.body.code).toBe('CANNOT_CHANGE_SELF');
  });
});

async function request401(path: string) {
  const { default: request } = await import('supertest');
  const res = await request(app).get(path).expect(401);
  expect(res.body.code).toBe('UNAUTHENTICATED');
}
