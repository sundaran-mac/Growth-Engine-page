import { describe, expect, it } from 'vitest';
import {
  buildCaption,
  buildTrackedLink,
  channelHow,
  chooseAsset,
  formatLine,
  MIN_LEAD_MS,
  nextBestWindow,
  slugify,
  utmMedium,
} from './rules.js';
import { codeChallengeS256, createCodeVerifier, createOAuthState, verifyOAuthState } from './oauth-state.js';

const IST = 'Asia/Kolkata';
const USER = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';

describe('buildTrackedLink', () => {
  it('matches the Figma example for REEL-031', () => {
    const link = buildTrackedLink({
      baseUrl: 'live.humini.app',
      campaignPrefix: 'live',
      platform: 'instagram',
      kind: 'reel',
      mode: 'M1',
      briefCode: 'REEL-031',
      when: new Date('2026-10-15T14:00:00Z'),
      timeZone: IST,
    });
    expect(link.display).toBe(
      'live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031',
    );
    expect(link.url.startsWith('https://')).toBe(true);
    expect(link.params.utm_content).toBe('REEL-031');
  });

  it('keeps an existing scheme, path and query, and uses the month in the audience zone', () => {
    const link = buildTrackedLink({
      baseUrl: 'http://example.com/app?ref=x',
      campaignPrefix: 'Humini Live',
      platform: 'youtube',
      kind: 'reel',
      mode: 'M2',
      briefCode: 'REEL-040',
      // 31 Oct 20:00 UTC is already 1 Nov in India.
      when: new Date('2026-10-31T20:00:00Z'),
      timeZone: IST,
    });
    const u = new URL(link.url);
    expect(u.protocol).toBe('http:');
    expect(u.pathname).toBe('/app');
    expect(u.searchParams.get('ref')).toBe('x');
    expect(u.searchParams.get('utm_medium')).toBe('short');
    expect(u.searchParams.get('utm_campaign')).toBe('humini-live-ai-people-nov');
  });

  it('maps brief kinds to utm_medium', () => {
    expect(utmMedium('poster', 'facebook')).toBe('post');
    expect(utmMedium('carousel', 'instagram')).toBe('carousel');
    expect(utmMedium('reel', 'linkedin')).toBe('reel');
    expect(slugify('  Ünïcode & Spaces ')).toBe('unicode-spaces');
  });
});

describe('nextBestWindow', () => {
  it('picks 7:30 pm IST the same day when the morning window has passed', () => {
    // 10:00 IST on Thu 15 Oct 2026.
    const at = nextBestWindow({ from: new Date('2026-10-15T04:30:00Z'), timeZone: IST });
    expect(at.toISOString()).toBe('2026-10-15T14:00:00.000Z');
  });

  it('picks 6:30 am next day after the evening window, and keeps the lead time', () => {
    // 19:20 IST: 19:30 is inside the 15 min lead time, so the next is 06:30 tomorrow.
    const at = nextBestWindow({ from: new Date('2026-10-15T13:50:00Z'), timeZone: IST });
    expect(at.toISOString()).toBe('2026-10-16T01:00:00.000Z');
    expect(at.getTime() - new Date('2026-10-15T13:50:00Z').getTime()).toBeGreaterThanOrEqual(MIN_LEAD_MS);
  });

  it('never goes before the launch date and skips taken times', () => {
    const from = new Date('2026-10-15T00:00:00Z');
    const first = nextBestWindow({ from, timeZone: IST, launchDate: '2026-11-01' });
    expect(first.toISOString()).toBe('2026-11-01T01:00:00.000Z');
    const second = nextBestWindow({ from, timeZone: IST, launchDate: '2026-11-01', taken: [first] });
    expect(second.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('is correct across a daylight saving change (London, 25 Oct 2026)', () => {
    const at = nextBestWindow({ from: new Date('2026-10-25T07:00:00Z'), timeZone: 'Europe/London' });
    // After the change London is UTC+0, so 19:30 local is 19:30 UTC.
    expect(at.toISOString()).toBe('2026-10-25T19:30:00.000Z');
  });
});

describe('channelHow', () => {
  const base = {
    platform: 'instagram' as const,
    status: 'connected' as const,
    hasToken: true,
    allowedActions: ['publish' as const],
    expiresAt: null,
    canRefresh: false,
  };

  it('treats connected without a token as not connected', () => {
    expect(channelHow({ ...base, hasToken: false })).toBe('not_connected');
  });
  it('gives auto for a connected account with a token and publish rights', () => {
    expect(channelHow(base)).toBe('auto');
    expect(channelHow({ ...base, status: 'error' })).toBe('auto');
  });
  it('gives reminder for WhatsApp and manual channels', () => {
    expect(channelHow({ ...base, platform: 'whatsapp' })).toBe('reminder');
    expect(channelHow({ ...base, status: 'manual' })).toBe('reminder');
  });
  it('gives needs_approval when the platform has not approved publishing', () => {
    expect(channelHow({ ...base, status: 'needs_approval' })).toBe('needs_approval');
    expect(channelHow({ ...base, allowedActions: [] })).toBe('needs_approval');
  });
  it('handles expired tokens', () => {
    const past = new Date(Date.now() - 1000);
    expect(channelHow({ ...base, expiresAt: past })).toBe('not_connected');
    expect(channelHow({ ...base, expiresAt: past, canRefresh: true })).toBe('auto');
    expect(channelHow({ ...base, status: 'disconnected' })).toBe('not_connected');
  });
});

describe('chooseAsset and formatLine', () => {
  const d = (s: string) => new Date(s);
  const assets = [
    { id: 'master', kind: 'video' as const, ratio: '16:9' as const, createdAt: d('2026-10-01') },
    { id: 'cut-916', kind: 'cutdown' as const, ratio: '9:16' as const, createdAt: d('2026-10-02') },
    { id: 'cut-916-new', kind: 'cutdown' as const, ratio: '9:16' as const, createdAt: d('2026-10-03') },
    { id: 'poster-45', kind: 'poster' as const, ratio: '4:5' as const, createdAt: d('2026-10-02') },
    { id: 'caption', kind: 'caption' as const, ratio: null, createdAt: d('2026-10-05') },
  ];

  it('prefers the newest video in the preferred ratio', () => {
    expect(chooseAsset(assets, ['9:16'])?.id).toBe('cut-916-new');
    expect(chooseAsset(assets, ['4:5', '1:1'])?.id).toBe('master');
  });
  it('falls back to a poster when there is no video', () => {
    expect(chooseAsset(assets.filter((a) => a.kind === 'poster' || a.kind === 'caption'), ['4:5'])?.id).toBe('poster-45');
    expect(chooseAsset([assets[4]!], ['9:16'])).toBeNull();
  });
  it('formats the format line', () => {
    expect(formatLine('9:16', 58_400)).toBe('9:16 · 58 s');
    expect(formatLine('4:5', null)).toBe('4:5');
    expect(formatLine(null, null)).toBeNull();
  });
});

describe('buildCaption', () => {
  it('adds the link where links are clickable, and "Link in bio" elsewhere', () => {
    const input = { hook: 'Hook', ask: 'Ask', trackedUrl: 'https://x.y/?a=1', maxLength: 2200 };
    expect(buildCaption({ ...input, clickableLinks: true })).toBe('Hook\n\nAsk\n\nhttps://x.y/?a=1');
    expect(buildCaption({ ...input, clickableLinks: false })).toBe('Hook\n\nAsk\n\nLink in bio.');
    expect(buildCaption({ ...input, hook: null, ask: '  ', trackedUrl: null, clickableLinks: true })).toBe('');
    expect(buildCaption({ ...input, clickableLinks: true, maxLength: 4 })).toBe('Hook');
  });
});

describe('OAuth state', () => {
  const secret = 'x'.repeat(40);
  const key = Buffer.alloc(32, 7);

  it('round-trips user, product and the encrypted PKCE verifier', () => {
    const verifier = createCodeVerifier();
    const state = createOAuthState({ platform: 'google', userId: USER, productId: PRODUCT, codeVerifier: verifier }, { secret, key });
    expect(state).not.toContain(verifier);
    const check = verifyOAuthState(state, 'google', { secret, key });
    expect(check).toMatchObject({ ok: true, payload: { userId: USER, productId: PRODUCT, codeVerifier: verifier } });
  });

  it('rejects a changed, expired, foreign or wrong-platform state', () => {
    const now = 1_800_000_000_000;
    const state = createOAuthState({ platform: 'meta', userId: USER, productId: null, codeVerifier: null }, { secret, key, now });
    expect(verifyOAuthState(state, 'meta', { secret, key, now })).toMatchObject({ ok: true });
    expect(verifyOAuthState(`${state}x`, 'meta', { secret, key, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyOAuthState(state, 'meta', { secret: 'y'.repeat(40), key, now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyOAuthState(state, 'meta', { secret, key, now: now + 11 * 60_000 })).toEqual({ ok: false, reason: 'expired' });
    expect(verifyOAuthState(state, 'linkedin', { secret, key, now })).toEqual({ ok: false, reason: 'wrong_platform' });
    expect(verifyOAuthState('garbage', 'meta', { secret, key, now })).toEqual({ ok: false, reason: 'malformed' });
  });

  it('makes an RFC 7636 verifier and S256 challenge', () => {
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    // RFC 7636 appendix B example.
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
