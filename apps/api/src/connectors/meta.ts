/**
 * Meta: one Facebook Login gives the Facebook Pages a person manages and the Instagram
 * business accounts linked to those Pages. Page tokens made from a long-lived user token do not
 * expire. Instagram calls use the Page token (Instagram API with Facebook Login).
 */
import { z } from 'zod';
import type { ChannelAction } from '@growth-desk/contract';
import { env } from '../config/env.js';
import { META_DIALOG_URL, META_GRAPH_BASE, META_GRAPH_VERSION } from './config.js';
import { httpRequest, runtime } from './http.js';
import {
  type AccountCredentials,
  type Connector,
  ConnectorError,
  type DiscoveredAccount,
  type OAuthProvider,
  type PostMetrics,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from './types.js';

export const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_manage_messages',
] as const;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const permissionsSchema = z.object({
  data: z.array(z.object({ permission: z.string(), status: z.string() })),
});

const pagesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string().optional(),
      tasks: z.array(z.string()).optional(),
      instagram_business_account: z
        .object({ id: z.string(), username: z.string().optional(), name: z.string().optional() })
        .optional(),
    }),
  ),
});

const idSchema = z.object({ id: z.string() });

function config(): { appId: string; appSecret: string } {
  if (!env.meta) throw new ConnectorError('NOT_CONNECTED', 'Meta is not set up: add META_APP_ID and META_APP_SECRET.');
  return { appId: env.meta.appId, appSecret: env.meta.appSecret };
}

function expiresFrom(seconds: number | undefined): Date | null {
  return seconds && seconds > 0 ? new Date(Date.now() + seconds * 1000) : null;
}

export function facebookActions(granted: ReadonlySet<string>): ChannelAction[] {
  const out: ChannelAction[] = [];
  if (granted.has('pages_manage_posts')) out.push('publish');
  if (granted.has('read_insights') || granted.has('pages_read_engagement')) out.push('insights');
  return out;
}

export function instagramActions(granted: ReadonlySet<string>): ChannelAction[] {
  const out: ChannelAction[] = [];
  if (granted.has('instagram_content_publish')) out.push('publish');
  if (granted.has('instagram_manage_insights')) out.push('insights');
  if (granted.has('instagram_manage_comments')) out.push('comments');
  if (granted.has('instagram_manage_messages')) out.push('messages');
  return out;
}

function describe(actions: ChannelAction[]): string {
  if (actions.length === 0) return 'Waiting for Meta approval';
  return actions.map((a, i) => (i === 0 ? a[0]!.toUpperCase() + a.slice(1) : a)).join(', ');
}

export const metaOAuth: OAuthProvider = {
  name: 'meta',
  // Facebook Login for the web uses the app secret; PKCE is not used here.
  supportsPkce: false,
  isConfigured: () => env.meta !== null,

  buildAuthUrl({ state, redirectUri }) {
    const { appId } = config();
    const u = new URL(META_DIALOG_URL);
    u.searchParams.set('client_id', appId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', META_SCOPES.join(','));
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
    const { appId, appSecret } = config();
    try {
      const short = await httpRequest({
        label: 'Meta',
        url: `${META_GRAPH_BASE}/oauth/access_token`,
        query: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
        schema: tokenSchema,
      });
      // Swap for a long-lived user token, so the Page tokens we read next never expire.
      const long = await httpRequest({
        label: 'Meta',
        url: `${META_GRAPH_BASE}/oauth/access_token`,
        query: {
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: short.data.access_token,
        },
        schema: tokenSchema,
      });
      return {
        accessToken: long.data.access_token,
        refreshToken: null,
        expiresAt: expiresFrom(long.data.expires_in),
        scopes: [],
      };
    } catch (err) {
      throw new ConnectorError('OAUTH_EXCHANGE_FAILED', err instanceof Error ? err.message : 'Meta sign-in failed.', { cause: err });
    }
  },

  async discoverAccounts(tokens): Promise<DiscoveredAccount[]> {
    const perms = await httpRequest({
      label: 'Meta',
      url: `${META_GRAPH_BASE}/me/permissions`,
      query: { access_token: tokens.accessToken },
      schema: permissionsSchema,
    });
    const granted = new Set(perms.data.data.filter((p) => p.status === 'granted').map((p) => p.permission));
    const pages = await httpRequest({
      label: 'Meta',
      url: `${META_GRAPH_BASE}/me/accounts`,
      query: {
        access_token: tokens.accessToken,
        fields: 'id,name,access_token,tasks,instagram_business_account{id,username,name}',
        limit: 100,
      },
      schema: pagesSchema,
    });
    const out: DiscoveredAccount[] = [];
    for (const page of pages.data.data) {
      if (!page.access_token) continue;
      const canCreate = !page.tasks || page.tasks.includes('CREATE_CONTENT');
      const fbActions = facebookActions(granted).filter((a) => a !== 'publish' || canCreate);
      out.push({
        platform: 'facebook',
        externalAccountId: page.id,
        displayName: `Facebook Page · ${page.name}`,
        handle: page.name,
        description: describe(fbActions),
        status: fbActions.includes('publish') ? 'connected' : 'needs_approval',
        allowedActions: fbActions,
        accessToken: page.access_token,
        refreshToken: null,
        expiresAt: null,
      });
      const ig = page.instagram_business_account;
      if (ig) {
        const igActions = instagramActions(granted);
        out.push({
          platform: 'instagram',
          externalAccountId: ig.id,
          displayName: `Instagram · ${ig.username ? `@${ig.username}` : (ig.name ?? page.name)}`,
          handle: ig.username ? `@${ig.username}` : null,
          description: describe(igActions),
          status: igActions.includes('publish') ? 'connected' : 'needs_approval',
          allowedActions: igActions,
          accessToken: page.access_token,
          refreshToken: null,
          expiresAt: null,
        });
      }
    }
    return out;
  },
};

/* ---------- Instagram ---------- */

const containerStatusSchema = z.object({
  status_code: z.string().optional(),
  status: z.string().optional(),
});

const permalinkSchema = z.object({ permalink: z.string().optional() });

const insightsSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.object({ value: z.number() })).optional(),
      total_value: z.object({ value: z.number() }).optional(),
    }),
  ),
});

function insightValue(data: z.infer<typeof insightsSchema>, name: string): number | null {
  const row = data.data.find((d) => d.name === name);
  if (!row) return null;
  return row.total_value?.value ?? row.values?.[0]?.value ?? null;
}

async function waitForContainer(containerId: string, token: string): Promise<void> {
  for (let i = 0; i < runtime.pollAttempts; i += 1) {
    const res = await httpRequest({
      label: 'Instagram',
      url: `${META_GRAPH_BASE}/${containerId}`,
      query: { fields: 'status_code,status', access_token: token },
      schema: containerStatusSchema,
    });
    const code = res.data.status_code;
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new ConnectorError('PLATFORM_ERROR', `Instagram could not process the video (${res.data.status ?? code}).`);
    }
    await runtime.sleep(runtime.pollIntervalMs);
  }
  throw new ConnectorError('PLATFORM_TIMEOUT', 'Instagram is still processing the video. Try again later.');
}

export const instagramConnector: Connector = {
  platform: 'instagram',
  capabilities: {
    publish: true,
    video: true,
    image: true,
    mediaTransfer: 'pull_url',
    ratios: ['9:16', '4:5', '1:1'],
    metrics: true,
    privateReply: true,
    maxCaptionLength: 2200,
    clickableLinks: false,
  },

  async publish({ account, media, caption }: PublishInput): Promise<PublishResult> {
    const token = account.accessToken;
    const base = `${META_GRAPH_BASE}/${account.externalAccountId}`;
    let form: Record<string, string>;
    if (media.kind === 'video') {
      form = { media_type: 'REELS', video_url: media.url, caption, share_to_feed: 'true', access_token: token };
    } else {
      if (!/jpe?g/i.test(media.mimeType)) {
        throw new ConnectorError('UNSUPPORTED_FORMAT', 'Instagram takes JPEG images only.');
      }
      form = { image_url: media.url, caption, access_token: token };
    }
    const container = await httpRequest({ label: 'Instagram', url: `${base}/media`, form, schema: idSchema });
    await waitForContainer(container.data.id, token);
    const published = await httpRequest({
      label: 'Instagram',
      url: `${base}/media_publish`,
      form: { creation_id: container.data.id, access_token: token },
      schema: idSchema,
    });
    let liveUrl: string | null = null;
    try {
      const link = await httpRequest({
        label: 'Instagram',
        url: `${META_GRAPH_BASE}/${published.data.id}`,
        query: { fields: 'permalink', access_token: token },
        schema: permalinkSchema,
      });
      liveUrl = link.data.permalink ?? null;
    } catch {
      // The post is live; a missing permalink is not a failure.
    }
    return { externalId: published.data.id, liveUrl };
  },

  async fetchMetrics({ account, externalId }): Promise<PostMetrics> {
    const res = await httpRequest({
      label: 'Instagram',
      url: `${META_GRAPH_BASE}/${externalId}/insights`,
      query: { metric: 'reach,saved,shares,comments', access_token: account.accessToken },
      schema: insightsSchema,
    });
    return {
      reach: insightValue(res.data, 'reach'),
      saves: insightValue(res.data, 'saved'),
      shares: insightValue(res.data, 'shares'),
      comments: insightValue(res.data, 'comments'),
      clicks: null,
    };
  },
};

/** Private reply to an Instagram comment (sent as a DM by the Page token). */
export async function instagramPrivateReply(account: AccountCredentials, commentId: string, message: string): Promise<string> {
  const res = await httpRequest({
    label: 'Instagram',
    url: `${META_GRAPH_BASE}/me/messages`,
    query: { access_token: account.accessToken },
    json: { recipient: { comment_id: commentId }, message: { text: message } },
    schema: z.object({ message_id: z.string().optional(), recipient_id: z.string().optional() }),
  });
  return res.data.message_id ?? commentId;
}

/* ---------- Facebook Page ---------- */

const reelStartSchema = z.object({ video_id: z.string(), upload_url: z.string().optional() });
const successSchema = z.object({ success: z.boolean().optional() });
const photoSchema = z.object({ id: z.string(), post_id: z.string().optional() });

export const facebookConnector: Connector = {
  platform: 'facebook',
  capabilities: {
    publish: true,
    video: true,
    image: true,
    mediaTransfer: 'pull_url',
    ratios: ['9:16', '4:5', '1:1', '16:9'],
    metrics: true,
    privateReply: false,
    maxCaptionLength: 5000,
    clickableLinks: true,
  },

  async publish({ account, media, caption }: PublishInput): Promise<PublishResult> {
    const token = account.accessToken;
    const pageId = account.externalAccountId;
    if (media.kind === 'image') {
      const res = await httpRequest({
        label: 'Facebook',
        url: `${META_GRAPH_BASE}/${pageId}/photos`,
        form: { url: media.url, message: caption, published: 'true', access_token: token },
        schema: photoSchema,
      });
      const postId = res.data.post_id ?? res.data.id;
      return { externalId: postId, liveUrl: `https://www.facebook.com/${postId}` };
    }
    const start = await httpRequest({
      label: 'Facebook',
      url: `${META_GRAPH_BASE}/${pageId}/video_reels`,
      form: { upload_phase: 'start', access_token: token },
      schema: reelStartSchema,
    });
    const videoId = start.data.video_id;
    const uploadUrl = start.data.upload_url ?? `https://rupload.facebook.com/video-upload/${META_GRAPH_VERSION}/${videoId}`;
    await httpRequest({
      label: 'Facebook',
      method: 'POST',
      url: uploadUrl,
      headers: { Authorization: `OAuth ${token}`, file_url: media.url },
      schema: successSchema,
    });
    await httpRequest({
      label: 'Facebook',
      url: `${META_GRAPH_BASE}/${pageId}/video_reels`,
      form: {
        upload_phase: 'finish',
        video_id: videoId,
        video_state: 'PUBLISHED',
        description: caption,
        access_token: token,
      },
      schema: successSchema,
    });
    return { externalId: videoId, liveUrl: `https://www.facebook.com/reel/${videoId}` };
  },

  async fetchMetrics({ account, externalId }): Promise<PostMetrics> {
    const res = await httpRequest({
      label: 'Facebook',
      url: `${META_GRAPH_BASE}/${externalId}/video_insights`,
      query: { metric: 'post_impressions_unique', access_token: account.accessToken },
      schema: insightsSchema,
    });
    return {
      reach: insightValue(res.data, 'post_impressions_unique'),
      saves: null,
      shares: null,
      comments: null,
      clicks: null,
    };
  },
};
