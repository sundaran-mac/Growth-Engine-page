/**
 * Connector unit tests. Every platform call is mocked with nock; nothing reaches a real platform.
 */
import nock from 'nock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { LINKEDIN_API_VERSION, META_GRAPH_VERSION } from './config.js';
import { googleOAuth, isYouTubeShort, youtubeConnector } from './google.js';
import { codeForStatus, httpRequest, platformMessage, runtime } from './http.js';
import { escapeLinkedInText, linkedinConnector, linkedinOAuth } from './linkedin.js';
import { facebookConnector, instagramConnector, instagramPrivateReply, metaOAuth } from './meta.js';
import { ConnectorError, type PublishInput } from './types.js';
import { whatsappConnector } from './whatsapp.js';

const GRAPH = 'https://graph.facebook.com';
const G = `/${META_GRAPH_VERSION}`;
const MEDIA = 'https://media.example.com';

const account = { externalAccountId: '1789', accessToken: 'tok-123', allowedActions: ['publish' as const] };

function input(over: Partial<PublishInput['media']> = {}): PublishInput {
  return {
    account,
    caption: 'Hook\n\nAsk',
    title: '60 seconds with Elan',
    media: {
      kind: 'video',
      url: `${MEDIA}/file.mp4?sig=1`,
      mimeType: 'video/mp4',
      sizeBytes: 10,
      durationMs: 58_000,
      ratio: '9:16',
      fileName: 'file.mp4',
      ...over,
    },
  };
}

const saved = { meta: env.meta, google: env.google, linkedin: env.linkedin };
const savedRuntime = { ...runtime };

beforeAll(() => {
  nock.disableNetConnect();
  env.meta = { appId: 'app-1', appSecret: 'secret-1', webhookVerifyToken: 'v' };
  env.google = { clientId: 'gid', clientSecret: 'gsecret' };
  env.linkedin = { clientId: 'lid', clientSecret: 'lsecret' };
  runtime.sleep = () => Promise.resolve();
  runtime.pollAttempts = 3;
});

afterAll(() => {
  nock.enableNetConnect();
  env.meta = saved.meta;
  env.google = saved.google;
  env.linkedin = saved.linkedin;
  Object.assign(runtime, savedRuntime);
});

beforeEach(() => nock.cleanAll());
afterEach(() => {
  expect(nock.pendingMocks()).toEqual([]);
});

describe('http client', () => {
  it('maps status codes and platform messages', () => {
    expect(codeForStatus(401)).toBe('PLATFORM_AUTH_FAILED');
    expect(codeForStatus(429)).toBe('PLATFORM_RATE_LIMITED');
    expect(codeForStatus(500)).toBe('PLATFORM_ERROR');
    expect(platformMessage({ error: { message: 'Bad token' } })).toBe('Bad token');
    expect(platformMessage({ error: 'invalid_grant', error_description: 'Expired' })).toBe('invalid_grant: Expired');
    expect(platformMessage(null)).toBeNull();
  });

  it('throws a typed error on a rate limit and on a bad answer shape', async () => {
    nock(GRAPH).get(`${G}/x`).reply(429, { error: { message: 'Too many calls' } });
    await expect(httpRequest({ label: 'Meta', url: `${GRAPH}${G}/x` })).rejects.toMatchObject({
      code: 'PLATFORM_RATE_LIMITED',
      httpStatus: 429,
    });
    const { z } = await import('zod');
    nock(GRAPH).get(`${G}/y`).reply(200, { nope: true });
    await expect(httpRequest({ label: 'Meta', url: `${GRAPH}${G}/y`, schema: z.object({ id: z.string() }) })).rejects.toMatchObject({
      code: 'PLATFORM_ERROR',
    });
  });

  it('times out with PLATFORM_TIMEOUT and maps network failure', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(httpRequest({ label: 'Meta', url: `${GRAPH}${G}/slow`, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'PLATFORM_TIMEOUT',
    });
    spy.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(httpRequest({ label: 'Meta', url: `${GRAPH}${G}/down` })).rejects.toMatchObject({ code: 'PLATFORM_ERROR' });
    spy.mockRestore();
  });
});

describe('Instagram', () => {
  it('publishes a reel: container, wait, publish, permalink', async () => {
    nock(GRAPH)
      .post(`${G}/1789/media`, (body: Record<string, string>) => body.media_type === 'REELS' && body.video_url === `${MEDIA}/file.mp4?sig=1`)
      .reply(200, { id: 'c1' })
      .get(`${G}/c1`)
      .query(true)
      .reply(200, { status_code: 'IN_PROGRESS' })
      .get(`${G}/c1`)
      .query(true)
      .reply(200, { status_code: 'FINISHED' })
      .post(`${G}/1789/media_publish`, { creation_id: 'c1', access_token: 'tok-123' })
      .reply(200, { id: 'm1' })
      .get(`${G}/m1`)
      .query({ fields: 'permalink', access_token: 'tok-123' })
      .reply(200, { permalink: 'https://www.instagram.com/reel/abc/' });
    await expect(instagramConnector.publish(input())).resolves.toEqual({
      externalId: 'm1',
      liveUrl: 'https://www.instagram.com/reel/abc/',
    });
  });

  it('fails when the container errors, and refuses non-JPEG images', async () => {
    nock(GRAPH).post(`${G}/1789/media`).reply(200, { id: 'c2' }).get(`${G}/c2`).query(true).reply(200, { status_code: 'ERROR', status: 'bad codec' });
    await expect(instagramConnector.publish(input())).rejects.toMatchObject({ code: 'PLATFORM_ERROR' });
    await expect(instagramConnector.publish(input({ kind: 'image', mimeType: 'image/png' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('reads insights and sends a private reply', async () => {
    nock(GRAPH)
      .get(`${G}/m1/insights`)
      .query(true)
      .reply(200, {
        data: [
          { name: 'reach', values: [{ value: 1200 }] },
          { name: 'saved', total_value: { value: 40 } },
          { name: 'shares', values: [{ value: 12 }] },
        ],
      })
      .post(`${G}/me/messages`, { recipient: { comment_id: 'cm1' }, message: { text: 'Here is the link' } })
      .query({ access_token: 'tok-123' })
      .reply(200, { recipient_id: 'r1', message_id: 'mid-1' });
    await expect(instagramConnector.fetchMetrics({ account, externalId: 'm1' })).resolves.toEqual({
      reach: 1200,
      saves: 40,
      shares: 12,
      comments: null,
      clicks: null,
    });
    await expect(instagramPrivateReply(account, 'cm1', 'Here is the link')).resolves.toBe('mid-1');
  });
});

describe('Facebook', () => {
  it('publishes a Page reel in three steps (start, upload from URL, finish)', async () => {
    nock(GRAPH)
      .post(`${G}/1789/video_reels`, (b: Record<string, string>) => b.upload_phase === 'start')
      .reply(200, { video_id: 'v9', upload_url: 'https://rupload.facebook.com/video-upload/v/v9' })
      .post(`${G}/1789/video_reels`, (b: Record<string, string>) => b.upload_phase === 'finish' && b.video_id === 'v9' && b.video_state === 'PUBLISHED')
      .reply(200, { success: true });
    nock('https://rupload.facebook.com', { reqheaders: { authorization: 'OAuth tok-123', file_url: `${MEDIA}/file.mp4?sig=1` } })
      .post('/video-upload/v/v9')
      .reply(200, { success: true });
    await expect(facebookConnector.publish(input())).resolves.toEqual({
      externalId: 'v9',
      liveUrl: 'https://www.facebook.com/reel/v9',
    });
  });

  it('posts a photo for an image', async () => {
    nock(GRAPH).post(`${G}/1789/photos`).reply(200, { id: 'p1', post_id: '1789_55' });
    await expect(facebookConnector.publish(input({ kind: 'image', mimeType: 'image/jpeg' }))).resolves.toEqual({
      externalId: '1789_55',
      liveUrl: 'https://www.facebook.com/1789_55',
    });
  });
});

describe('YouTube', () => {
  it('uploads with a resumable session and returns a Shorts link for 9:16 under 3 min', async () => {
    nock('https://www.googleapis.com', { reqheaders: { authorization: 'Bearer tok-123' } })
      .post('/upload/youtube/v3/videos', (b: { snippet: { title: string }; status: { privacyStatus: string } }) => b.snippet.title === '60 seconds with Elan' && b.status.privacyStatus === 'public')
      .query({ uploadType: 'resumable', part: 'snippet,status' })
      .reply(200, {}, { Location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=U1' })
      .put('/upload/youtube/v3/videos', 'abcdefghij')
      .query({ upload_id: 'U1' })
      .reply(200, { id: 'yt1' });
    nock(MEDIA).get('/file.mp4').query({ sig: '1' }).reply(200, 'abcdefghij', { 'Content-Length': '10' });
    await expect(youtubeConnector.publish(input())).resolves.toEqual({
      externalId: 'yt1',
      liveUrl: 'https://www.youtube.com/shorts/yt1',
    });
    expect(isYouTubeShort('16:9', 30_000)).toBe(false);
    expect(isYouTubeShort('9:16', 200_000)).toBe(false);
  });

  it('refuses images', async () => {
    await expect(youtubeConnector.publish(input({ kind: 'image' }))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
  });
});

describe('LinkedIn', () => {
  const urn = 'urn:li:person:abc';
  const li = { ...input(), account: { ...account, externalAccountId: urn } };

  it('uploads video parts, finalises, waits, then creates the post', async () => {
    nock('https://api.linkedin.com', { reqheaders: { 'linkedin-version': LINKEDIN_API_VERSION, 'x-restli-protocol-version': '2.0.0' } })
      .post('/rest/videos', (b: { initializeUploadRequest: { owner: string; fileSizeBytes: number } }) => b.initializeUploadRequest.owner === urn && b.initializeUploadRequest.fileSizeBytes === 10)
      .query({ action: 'initializeUpload' })
      .reply(200, {
        value: {
          video: 'urn:li:video:V1',
          uploadToken: '',
          uploadInstructions: [
            { uploadUrl: 'https://upload.linkedin.example/p1', firstByte: 0, lastByte: 4 },
            { uploadUrl: 'https://upload.linkedin.example/p2', firstByte: 5, lastByte: 9 },
          ],
        },
      })
      .post('/rest/videos', (b: { finalizeUploadRequest: { uploadedPartIds: string[] } }) => b.finalizeUploadRequest.uploadedPartIds.join() === 'e1,e2')
      .query({ action: 'finalizeUpload' })
      .reply(200, {})
      .get(`/rest/videos/${encodeURIComponent('urn:li:video:V1')}`)
      .reply(200, { status: 'PROCESSING' })
      .get(`/rest/videos/${encodeURIComponent('urn:li:video:V1')}`)
      .reply(200, { status: 'AVAILABLE' })
      .post('/rest/posts', (b: { author: string; content: { media: { id: string } }; commentary: string }) => b.author === urn && b.content.media.id === 'urn:li:video:V1')
      .reply(201, '', { 'x-restli-id': 'urn:li:share:77' });
    nock(MEDIA, { reqheaders: { range: 'bytes=0-4' } }).get('/file.mp4').query(true).reply(206, 'abcde');
    nock(MEDIA, { reqheaders: { range: 'bytes=5-9' } }).get('/file.mp4').query(true).reply(206, 'fghij');
    nock('https://upload.linkedin.example').put('/p1', 'abcde').reply(200, '', { ETag: 'e1' }).put('/p2', 'fghij').reply(200, '', { ETag: 'e2' });
    await expect(linkedinConnector.publish(li)).resolves.toEqual({
      externalId: 'urn:li:share:77',
      liveUrl: 'https://www.linkedin.com/feed/update/urn:li:share:77/',
    });
  });

  it('maps a 403 to NEEDS_APPROVAL and escapes commentary', async () => {
    nock('https://api.linkedin.com').post('/rest/videos').query(true).reply(403, { message: 'Not enough permissions' });
    await expect(linkedinConnector.publish(li)).rejects.toMatchObject({ code: 'NEEDS_APPROVAL' });
    expect(escapeLinkedInText('Hi (all) @team #1')).toBe('Hi \\(all\\) \\@team \\#1');
    await expect(linkedinConnector.fetchMetrics({ account, externalId: 'x' })).rejects.toBeInstanceOf(ConnectorError);
  });
});

describe('WhatsApp', () => {
  it('never posts', async () => {
    expect(whatsappConnector.capabilities.publish).toBe(false);
    await expect(whatsappConnector.publish(input())).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
  });
});

describe('OAuth providers', () => {
  it('Meta: builds the dialog URL and finds Pages with linked Instagram accounts', async () => {
    const url = new URL(metaOAuth.buildAuthUrl({ state: 's1', redirectUri: 'https://app/cb', codeChallenge: null }));
    expect(url.searchParams.get('client_id')).toBe('app-1');
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
    expect(url.searchParams.get('code_challenge')).toBeNull();

    nock(GRAPH)
      .get(`${G}/oauth/access_token`)
      .query((q) => q.code === 'c1' && q.client_secret === 'secret-1')
      .reply(200, { access_token: 'short' })
      .get(`${G}/oauth/access_token`)
      .query((q) => q.grant_type === 'fb_exchange_token' && q.fb_exchange_token === 'short')
      .reply(200, { access_token: 'long', expires_in: 5_184_000 });
    const tokens = await metaOAuth.exchangeCode({ code: 'c1', redirectUri: 'https://app/cb', codeVerifier: null });
    expect(tokens.accessToken).toBe('long');

    nock(GRAPH)
      .get(`${G}/me/permissions`)
      .query(true)
      .reply(200, {
        data: [
          { permission: 'pages_manage_posts', status: 'granted' },
          { permission: 'instagram_content_publish', status: 'granted' },
          { permission: 'instagram_manage_messages', status: 'declined' },
        ],
      })
      .get(`${G}/me/accounts`)
      .query(true)
      .reply(200, {
        data: [
          { id: 'pg1', name: 'Humini Live', access_token: 'page-tok', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: 'ig1', username: 'humini.live' } },
          { id: 'pg2', name: 'No token page' },
        ],
      });
    const found = await metaOAuth.discoverAccounts(tokens);
    expect(found.map((a) => [a.platform, a.externalAccountId, a.status, a.allowedActions])).toEqual([
      ['facebook', 'pg1', 'connected', ['publish']],
      ['instagram', 'ig1', 'connected', ['publish']],
    ]);
    expect(found[1]!.accessToken).toBe('page-tok');
  });

  it('Google: sends the PKCE verifier and finds the channel', async () => {
    const url = new URL(googleOAuth.buildAuthUrl({ state: 's', redirectUri: 'https://app/cb', codeChallenge: 'chal' }));
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    nock('https://oauth2.googleapis.com')
      .post('/token', (b: Record<string, string>) => b.code_verifier === 'ver' && b.grant_type === 'authorization_code')
      .reply(200, { access_token: 'ga', refresh_token: 'gr', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' });
    const tokens = await googleOAuth.exchangeCode({ code: 'c', redirectUri: 'https://app/cb', codeVerifier: 'ver' });
    nock('https://www.googleapis.com').get('/youtube/v3/channels').query(true).reply(200, { items: [{ id: 'UC1', snippet: { title: 'Humini Live', customUrl: '@huminilive' } }] });
    const found = await googleOAuth.discoverAccounts(tokens);
    expect(found[0]).toMatchObject({ platform: 'youtube', externalAccountId: 'UC1', status: 'connected', allowedActions: ['publish', 'insights'], refreshToken: 'gr' });
  });

  it('Google: a failed exchange is OAUTH_EXCHANGE_FAILED', async () => {
    nock('https://oauth2.googleapis.com').post('/token').reply(400, { error: 'invalid_grant' });
    await expect(googleOAuth.exchangeCode({ code: 'c', redirectUri: 'r', codeVerifier: 'v' })).rejects.toMatchObject({ code: 'OAUTH_EXCHANGE_FAILED' });
  });

  it('LinkedIn: connects the member; company pages need approval', async () => {
    nock('https://www.linkedin.com').post('/oauth/v2/accessToken').reply(200, { access_token: 'la', expires_in: 5_184_000, scope: 'openid,profile,w_member_social' });
    const tokens = await linkedinOAuth.exchangeCode({ code: 'c', redirectUri: 'r', codeVerifier: null });
    nock('https://api.linkedin.com')
      .get('/v2/userinfo')
      .reply(200, { sub: 'abc', name: 'Elan' })
      .get('/rest/organizationAcls')
      .query(true)
      .reply(403, { message: 'Not enough permissions' });
    const found = await linkedinOAuth.discoverAccounts(tokens);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ externalAccountId: 'urn:li:person:abc', status: 'connected', allowedActions: ['publish'] });
  });
});
