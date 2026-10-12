/**
 * OAuth connect, end to end through the routes: start -> provider (mocked) -> callback -> web.
 */
import { eq } from 'drizzle-orm';
import nock from 'nock';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { META_GRAPH_VERSION } from '../../connectors/config.js';
import { db } from '../../db/client.js';
import { auditLogs, channelAccounts } from '../../db/schema/index.js';
import { decryptSecret } from '../../lib/crypto.js';
import { addMember, createTestProduct, createTestUser, loginAgent, truncateAll } from '../../../test/helpers.js';
import { codeChallengeS256, createOAuthState } from './oauth-state.js';
import { makeChannel } from './test-fixtures.js';

const app = createApp();
const GRAPH = 'https://graph.facebook.com';
const G = `/${META_GRAPH_VERSION}`;
const WEB = env.webOrigins[0];
const saved = { meta: env.meta, google: env.google };

beforeAll(() => {
  nock.disableNetConnect();
  nock.enableNetConnect(/127\.0\.0\.1|localhost/);
  env.meta = { appId: 'app-1', appSecret: 'secret-1', webhookVerifyToken: 'v' };
  env.google = { clientId: 'gid', clientSecret: 'gsecret' };
});
afterAll(() => {
  nock.enableNetConnect();
  env.meta = saved.meta;
  env.google = saved.google;
});
beforeEach(async () => {
  await truncateAll();
  nock.cleanAll();
});

function stateFrom(url: string): string {
  return new URL(url).searchParams.get('state')!;
}

function mockMeta() {
  nock(GRAPH)
    .get(`${G}/oauth/access_token`)
    .query((q) => q.code === 'good-code' && q.redirect_uri === `${env.oauthRedirectBaseUrl}/api/v1/integrations/oauth/meta/callback`)
    .reply(200, { access_token: 'short' })
    .get(`${G}/oauth/access_token`)
    .query((q) => q.grant_type === 'fb_exchange_token')
    .reply(200, { access_token: 'long-user', expires_in: 5_184_000 })
    .get(`${G}/me/permissions`)
    .query(true)
    .reply(200, {
      data: ['pages_manage_posts', 'read_insights', 'instagram_content_publish', 'instagram_manage_comments'].map((permission) => ({ permission, status: 'granted' })),
    })
    .get(`${G}/me/accounts`)
    .query(true)
    .reply(200, {
      data: [{ id: 'pg1', name: 'Humini Live', access_token: 'page-token-secret', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: 'ig1', username: 'humini.live' } }],
    });
}

describe('OAuth connect', () => {
  it('Meta: start gives a signed URL, callback stores encrypted tokens and redirects to the web', async () => {
    const editor = await createTestUser({ role: 'editor' });
    // Seed-style placeholder (connected, no token) is taken over, not duplicated.
    const placeholder = await makeChannel({ platform: 'instagram', withToken: false, externalAccountId: null });
    const agent = await loginAgent(app, editor);
    const start = await agent.get('/api/v1/integrations/oauth/meta/start').expect(200);
    expect(start.headers['cache-control']).toBe('no-store');
    const url = new URL(start.body.url);
    expect(url.host).toBe('www.facebook.com');
    expect(url.searchParams.get('redirect_uri')).toBe(`${env.oauthRedirectBaseUrl}/api/v1/integrations/oauth/meta/callback`);

    mockMeta();
    const cb = await agent.get('/api/v1/integrations/oauth/meta/callback').query({ code: 'good-code', state: stateFrom(start.body.url) }).expect(302);
    expect(cb.headers.location).toBe(`${WEB}/integrations?connected=meta`);

    const rows = await db.select().from(channelAccounts);
    expect(rows).toHaveLength(2);
    const ig = rows.find((r) => r.platform === 'instagram')!;
    expect(ig.id).toBe(placeholder.id);
    expect(ig).toMatchObject({ externalAccountId: 'ig1', status: 'connected', handle: '@humini.live', connectedById: editor.id });
    expect(ig.allowedActions).toEqual(['publish', 'comments']);
    expect(ig.accessTokenEnc).not.toContain('page-token-secret');
    expect(decryptSecret(ig.accessTokenEnc!)).toBe('page-token-secret');
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'channel.connect'));
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('page-token-secret');

    // Connecting again updates the same rows.
    const again = await agent.get('/api/v1/integrations/oauth/meta/start').expect(200);
    mockMeta();
    await agent.get('/api/v1/integrations/oauth/meta/callback').query({ code: 'good-code', state: stateFrom(again.body.url) }).expect(302);
    expect(await db.select().from(channelAccounts)).toHaveLength(2);
  });

  it('Google: uses PKCE, the verifier in the token call matches the challenge', async () => {
    const admin = await createTestUser({ role: 'admin' });
    const product = await createTestProduct();
    const agent = await loginAgent(app, admin);
    const start = await agent.get(`/api/v1/integrations/oauth/google/start?productId=${product.id}`).expect(200);
    const challenge = new URL(start.body.url).searchParams.get('code_challenge');
    expect(challenge).toBeTruthy();
    let verifierOk = false;
    nock('https://oauth2.googleapis.com')
      .post('/token', (b: Record<string, string>) => {
        verifierOk = codeChallengeS256(b.code_verifier ?? '') === challenge;
        return true;
      })
      .reply(200, { access_token: 'ga', refresh_token: 'gr', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload' });
    nock('https://www.googleapis.com').get('/youtube/v3/channels').query(true).reply(200, { items: [{ id: 'UC1', snippet: { title: 'Humini Live' } }] });
    const cb = await request(app).get('/api/v1/integrations/oauth/google/callback').query({ code: 'c', state: stateFrom(start.body.url) }).expect(302);
    expect(cb.headers.location).toBe(`${WEB}/integrations?connected=google`);
    expect(verifierOk).toBe(true);
    const [yt] = await db.select().from(channelAccounts).where(eq(channelAccounts.platform, 'youtube'));
    expect(yt).toMatchObject({ productId: product.id, externalAccountId: 'UC1', allowedActions: ['publish'] });
    expect(decryptSecret(yt!.refreshTokenEnc!)).toBe('gr');
  });

  it('rejects a bad, foreign or reused-by-another-user state', async () => {
    const editor = await createTestUser({ role: 'editor' });
    const other = await createTestUser({ role: 'editor' });
    const agent = await loginAgent(app, editor);
    const start = await agent.get('/api/v1/integrations/oauth/meta/start').expect(200);
    const state = stateFrom(start.body.url);

    const bad = await request(app).get('/api/v1/integrations/oauth/meta/callback').query({ code: 'x', state: `${state}x` }).expect(302);
    expect(bad.headers.location).toMatch(new RegExp(`^${WEB}/integrations\\?error=OAUTH_STATE_INVALID&message=.+`));
    const wrongPlatform = await request(app).get('/api/v1/integrations/oauth/google/callback').query({ code: 'x', state }).expect(302);
    expect(wrongPlatform.headers.location).toContain('error=OAUTH_STATE_INVALID');
    const otherAgent = await loginAgent(app, other);
    const foreign = await otherAgent.get('/api/v1/integrations/oauth/meta/callback').query({ code: 'x', state }).expect(302);
    expect(foreign.headers.location).toContain('error=OAUTH_STATE_INVALID');
    const missing = await request(app).get('/api/v1/integrations/oauth/meta/callback').expect(302);
    expect(missing.headers.location).toContain('error=OAUTH_STATE_INVALID');
    expect(await db.select().from(channelAccounts)).toHaveLength(0);
  });

  it('handles a denied consent, a member without rights and a failed exchange', async () => {
    const editor = await createTestUser({ role: 'editor' });
    const member = await createTestUser({ role: 'member' });
    const product = await createTestProduct();
    await addMember(product.id, member.id, 'owner');
    const agent = await loginAgent(app, editor);

    const s1 = stateFrom((await agent.get('/api/v1/integrations/oauth/meta/start').expect(200)).body.url);
    const denied = await request(app).get('/api/v1/integrations/oauth/meta/callback').query({ error: 'access_denied', state: s1 }).expect(302);
    expect(denied.headers.location).toContain('error=OAUTH_DENIED');
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, 'channel.connect_denied'))).toHaveLength(1);

    const memberState = createOAuthState({ platform: 'meta', userId: member.id, productId: null, codeVerifier: null });
    const forbidden = await request(app).get('/api/v1/integrations/oauth/meta/callback').query({ code: 'x', state: memberState }).expect(302);
    expect(forbidden.headers.location).toContain('error=FORBIDDEN');

    const s2 = stateFrom((await agent.get('/api/v1/integrations/oauth/meta/start').expect(200)).body.url);
    nock(GRAPH).get(`${G}/oauth/access_token`).query(true).reply(400, { error: { message: 'Code expired' } });
    const failed = await request(app).get('/api/v1/integrations/oauth/meta/callback').query({ code: 'old', state: s2 }).expect(302);
    expect(failed.headers.location).toContain('error=OAUTH_EXCHANGE_FAILED');
  });
});
