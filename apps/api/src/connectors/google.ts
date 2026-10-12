/**
 * Google: OAuth (with PKCE) for a YouTube channel, and the YouTube connector (resumable upload).
 */
import { z } from 'zod';
import type { ChannelAction } from '@growth-desk/contract';
import { env } from '../config/env.js';
import {
  GOOGLE_AUTH_URL,
  GOOGLE_TOKEN_URL,
  YOUTUBE_API_BASE,
  YOUTUBE_PRIVACY,
  YOUTUBE_SHORT_MAX_MS,
  YOUTUBE_UPLOAD_URL,
} from './config.js';
import { httpRequest, UPLOAD_TIMEOUT_MS } from './http.js';
import { openMediaStream } from './media.js';
import {
  type Connector,
  ConnectorError,
  type DiscoveredAccount,
  type OAuthProvider,
  type PostMetrics,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from './types.js';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

const channelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string(), customUrl: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

function config(): { clientId: string; clientSecret: string } {
  if (!env.google) throw new ConnectorError('NOT_CONNECTED', 'Google is not set up: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  return env.google;
}

function toTokenSet(data: z.infer<typeof tokenSchema>, previousRefresh: string | null = null): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefresh,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope ? data.scope.split(/\s+/).filter(Boolean) : [],
  };
}

export function youtubeActions(scopes: readonly string[]): ChannelAction[] {
  const out: ChannelAction[] = [];
  if (scopes.some((s) => s.endsWith('/youtube.upload') || s.endsWith('/youtube'))) out.push('publish');
  if (scopes.some((s) => s.endsWith('/youtube.readonly') || s.endsWith('/youtube'))) out.push('insights');
  return out;
}

export const googleOAuth: OAuthProvider = {
  name: 'google',
  supportsPkce: true,
  isConfigured: () => env.google !== null,

  buildAuthUrl({ state, redirectUri, codeChallenge }) {
    const { clientId } = config();
    const u = new URL(GOOGLE_AUTH_URL);
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('include_granted_scopes', 'true');
    u.searchParams.set('state', state);
    if (codeChallenge) {
      u.searchParams.set('code_challenge', codeChallenge);
      u.searchParams.set('code_challenge_method', 'S256');
    }
    return u.toString();
  },

  async exchangeCode({ code, redirectUri, codeVerifier }): Promise<TokenSet> {
    const { clientId, clientSecret } = config();
    try {
      const res = await httpRequest({
        label: 'Google',
        url: GOOGLE_TOKEN_URL,
        form: {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        },
        schema: tokenSchema,
      });
      return toTokenSet(res.data);
    } catch (err) {
      throw new ConnectorError('OAUTH_EXCHANGE_FAILED', err instanceof Error ? err.message : 'Google sign-in failed.', { cause: err });
    }
  },

  async discoverAccounts(tokens): Promise<DiscoveredAccount[]> {
    const res = await httpRequest({
      label: 'YouTube',
      url: `${YOUTUBE_API_BASE}/channels`,
      query: { part: 'snippet', mine: 'true' },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      schema: channelsSchema,
    });
    const actions = youtubeActions(tokens.scopes.length > 0 ? tokens.scopes : [...GOOGLE_SCOPES]);
    return (res.data.items ?? []).map((ch) => ({
      platform: 'youtube' as const,
      externalAccountId: ch.id,
      displayName: `YouTube · ${ch.snippet?.title ?? ch.id}`,
      handle: ch.snippet?.customUrl ?? null,
      description: 'Shorts, long video, analytics',
      status: actions.includes('publish') ? ('connected' as const) : ('needs_approval' as const),
      allowedActions: actions,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    }));
  },

  async refresh(refreshToken: string): Promise<TokenSet> {
    const { clientId, clientSecret } = config();
    const res = await httpRequest({
      label: 'Google',
      url: GOOGLE_TOKEN_URL,
      form: {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      schema: tokenSchema,
    });
    return toTokenSet(res.data, refreshToken);
  },
};

/* ---------- YouTube ---------- */

const videoSchema = z.object({ id: z.string() });
const statsSchema = z.object({
  items: z
    .array(
      z.object({
        statistics: z
          .object({ viewCount: z.string().optional(), commentCount: z.string().optional() })
          .optional(),
      }),
    )
    .optional(),
});

export function isYouTubeShort(ratio: string | null, durationMs: number | null): boolean {
  return ratio === '9:16' && durationMs !== null && durationMs <= YOUTUBE_SHORT_MAX_MS;
}

export const youtubeConnector: Connector = {
  platform: 'youtube',
  capabilities: {
    publish: true,
    video: true,
    image: false,
    mediaTransfer: 'push_bytes',
    ratios: ['9:16', '16:9'],
    metrics: true,
    privateReply: false,
    maxCaptionLength: 5000,
    clickableLinks: true,
  },

  async publish({ account, media, caption, title }: PublishInput): Promise<PublishResult> {
    if (media.kind !== 'video') throw new ConnectorError('UNSUPPORTED_FORMAT', 'YouTube takes video only.');
    const auth = { Authorization: `Bearer ${account.accessToken}` };
    const short = isYouTubeShort(media.ratio, media.durationMs);
    const init = await httpRequest({
      label: 'YouTube',
      url: YOUTUBE_UPLOAD_URL,
      query: { uploadType: 'resumable', part: 'snippet,status' },
      headers: {
        ...auth,
        'X-Upload-Content-Type': media.mimeType,
        ...(media.sizeBytes ? { 'X-Upload-Content-Length': String(media.sizeBytes) } : {}),
      },
      json: {
        snippet: { title: title.slice(0, 100), description: caption.slice(0, 5000), categoryId: '22' },
        status: { privacyStatus: YOUTUBE_PRIVACY, selfDeclaredMadeForKids: false },
      },
    });
    const location = init.headers.get('location');
    if (!location) throw new ConnectorError('PLATFORM_ERROR', 'YouTube did not start the upload.');

    const file = await openMediaStream(media.url);
    const length = media.sizeBytes ?? file.length;
    const uploaded = await httpRequest({
      label: 'YouTube',
      method: 'PUT',
      url: location,
      headers: {
        ...auth,
        'Content-Type': media.mimeType,
        ...(length ? { 'Content-Length': String(length) } : {}),
      },
      body: file.body,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      schema: videoSchema,
    });
    const id = uploaded.data.id;
    return {
      externalId: id,
      liveUrl: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    };
  },

  async fetchMetrics({ account, externalId }): Promise<PostMetrics> {
    const res = await httpRequest({
      label: 'YouTube',
      url: `${YOUTUBE_API_BASE}/videos`,
      query: { part: 'statistics', id: externalId },
      headers: { Authorization: `Bearer ${account.accessToken}` },
      schema: statsSchema,
    });
    const s = res.data.items?.[0]?.statistics;
    const num = (v: string | undefined) => (v === undefined ? null : Number(v));
    return { reach: num(s?.viewCount), saves: null, shares: null, comments: num(s?.commentCount), clicks: null };
  },
};
