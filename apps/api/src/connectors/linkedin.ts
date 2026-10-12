/**
 * LinkedIn: OAuth for a member (Share on LinkedIn, `w_member_social`), organisation discovery
 * (needs Community Management API approval), and posting through the Videos, Images and Posts
 * APIs with a current `LinkedIn-Version` header.
 */
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  LINKEDIN_API_BASE,
  LINKEDIN_API_VERSION,
  LINKEDIN_AUTH_URL,
  LINKEDIN_TOKEN_URL,
} from './config.js';
import { httpRequest, runtime, UPLOAD_TIMEOUT_MS } from './http.js';
import { readMediaRange } from './media.js';
import {
  type Connector,
  ConnectorError,
  type DiscoveredAccount,
  type OAuthProvider,
  type PublishInput,
  type PublishResult,
  type TokenSet,
} from './types.js';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

const userInfoSchema = z.object({ sub: z.string(), name: z.string().optional() });

const aclsSchema = z.object({
  elements: z.array(z.object({ organization: z.string() })).optional(),
});

const orgSchema = z.object({ localizedName: z.string().optional(), vanityName: z.string().optional() });

function config(): { clientId: string; clientSecret: string } {
  if (!env.linkedin) throw new ConnectorError('NOT_CONNECTED', 'LinkedIn is not set up: add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.');
  return env.linkedin;
}

export function restHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'LinkedIn-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

function toTokenSet(data: z.infer<typeof tokenSchema>, previousRefresh: string | null = null): TokenSet {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previousRefresh,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: data.scope ? data.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

export const linkedinOAuth: OAuthProvider = {
  name: 'linkedin',
  // PKCE on LinkedIn is for native apps only; the web flow uses the client secret.
  supportsPkce: false,
  isConfigured: () => env.linkedin !== null,

  buildAuthUrl({ state, redirectUri }) {
    const { clientId } = config();
    const u = new URL(LINKEDIN_AUTH_URL);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('scope', LINKEDIN_SCOPES.join(' '));
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }): Promise<TokenSet> {
    const { clientId, clientSecret } = config();
    try {
      const res = await httpRequest({
        label: 'LinkedIn',
        url: LINKEDIN_TOKEN_URL,
        form: {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
        schema: tokenSchema,
      });
      return toTokenSet(res.data);
    } catch (err) {
      throw new ConnectorError('OAUTH_EXCHANGE_FAILED', err instanceof Error ? err.message : 'LinkedIn sign-in failed.', { cause: err });
    }
  },

  async discoverAccounts(tokens): Promise<DiscoveredAccount[]> {
    const me = await httpRequest({
      label: 'LinkedIn',
      url: `${LINKEDIN_API_BASE}/v2/userinfo`,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      schema: userInfoSchema,
    });
    const canPost = tokens.scopes.length === 0 || tokens.scopes.includes('w_member_social');
    const out: DiscoveredAccount[] = [
      {
        platform: 'linkedin',
        externalAccountId: `urn:li:person:${me.data.sub}`,
        displayName: `LinkedIn · ${me.data.name ?? 'Member'}`,
        handle: me.data.name ?? null,
        description: canPost ? 'Posts as this member' : 'Waiting for LinkedIn approval',
        status: canPost ? 'connected' : 'needs_approval',
        allowedActions: canPost ? ['publish'] : [],
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    ];

    // Company pages: only readable after LinkedIn approves the Community Management API.
    try {
      const acls = await httpRequest({
        label: 'LinkedIn',
        url: `${LINKEDIN_API_BASE}/rest/organizationAcls`,
        query: { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED' },
        headers: restHeaders(tokens.accessToken),
        schema: aclsSchema,
      });
      const orgScope = tokens.scopes.includes('w_organization_social');
      for (const el of acls.data.elements ?? []) {
        let name = el.organization;
        try {
          const id = el.organization.split(':').pop() ?? '';
          const org = await httpRequest({
            label: 'LinkedIn',
            url: `${LINKEDIN_API_BASE}/rest/organizations/${encodeURIComponent(id)}`,
            headers: restHeaders(tokens.accessToken),
            schema: orgSchema,
          });
          name = org.data.localizedName ?? name;
        } catch {
          // Keep the URN as the name.
        }
        out.push({
          platform: 'linkedin',
          externalAccountId: el.organization,
          displayName: `LinkedIn · ${name}`,
          handle: name,
          description: orgScope ? 'Posts as the company page' : 'Company page: needs Community Management API approval',
          status: orgScope ? 'connected' : 'needs_approval',
          allowedActions: orgScope ? ['publish'] : [],
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        });
      }
    } catch {
      // No approval yet: only the member account is connected.
    }
    return out;
  },

  async refresh(refreshToken: string): Promise<TokenSet> {
    const { clientId, clientSecret } = config();
    const res = await httpRequest({
      label: 'LinkedIn',
      url: LINKEDIN_TOKEN_URL,
      form: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret },
      schema: tokenSchema,
    });
    return toTokenSet(res.data, refreshToken);
  },
};

/* ---------- Posting ---------- */

/** LinkedIn "little text" format: these characters must be escaped in commentary. */
export function escapeLinkedInText(text: string): string {
  return text.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

const videoInitSchema = z.object({
  value: z.object({
    video: z.string(),
    uploadToken: z.string().optional().default(''),
    uploadInstructions: z.array(
      z.object({ uploadUrl: z.string(), firstByte: z.number(), lastByte: z.number() }),
    ),
  }),
});

const imageInitSchema = z.object({
  value: z.object({ uploadUrl: z.string(), image: z.string() }),
});

const videoStatusSchema = z.object({ status: z.string().optional() });

/** 403 on LinkedIn usually means the app lacks the product approval for this action. */
function mapForbidden(err: unknown): never {
  if (err instanceof ConnectorError && err.httpStatus === 403) {
    throw new ConnectorError('NEEDS_APPROVAL', `LinkedIn refused: our app needs approval for this. ${err.message}`, { httpStatus: 403, cause: err });
  }
  throw err;
}

async function uploadVideo(owner: string, token: string, url: string, sizeBytes: number): Promise<string> {
  const init = await httpRequest({
    label: 'LinkedIn',
    url: `${LINKEDIN_API_BASE}/rest/videos`,
    query: { action: 'initializeUpload' },
    headers: restHeaders(token),
    json: { initializeUploadRequest: { owner, fileSizeBytes: sizeBytes, uploadCaptions: false, uploadThumbnail: false } },
    schema: videoInitSchema,
  }).catch(mapForbidden);
  const { video, uploadToken, uploadInstructions } = init.data.value;
  const etags: string[] = [];
  for (const part of uploadInstructions) {
    const bytes = await readMediaRange(url, part.firstByte, part.lastByte);
    const res = await httpRequest({
      label: 'LinkedIn',
      method: 'PUT',
      url: part.uploadUrl,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    const etag = res.headers.get('etag');
    if (!etag) throw new ConnectorError('PLATFORM_ERROR', 'LinkedIn did not confirm a video part.');
    etags.push(etag);
  }
  await httpRequest({
    label: 'LinkedIn',
    url: `${LINKEDIN_API_BASE}/rest/videos`,
    query: { action: 'finalizeUpload' },
    headers: restHeaders(token),
    json: { finalizeUploadRequest: { video, uploadToken, uploadedPartIds: etags } },
  });
  for (let i = 0; i < runtime.pollAttempts; i += 1) {
    const st = await httpRequest({
      label: 'LinkedIn',
      url: `${LINKEDIN_API_BASE}/rest/videos/${encodeURIComponent(video)}`,
      headers: restHeaders(token),
      schema: videoStatusSchema,
    });
    if (st.data.status === 'AVAILABLE') return video;
    if (st.data.status === 'PROCESSING_FAILED') throw new ConnectorError('PLATFORM_ERROR', 'LinkedIn could not process the video.');
    await runtime.sleep(runtime.pollIntervalMs);
  }
  throw new ConnectorError('PLATFORM_TIMEOUT', 'LinkedIn is still processing the video. Try again later.');
}

async function uploadImage(owner: string, token: string, url: string, sizeBytes: number): Promise<string> {
  const init = await httpRequest({
    label: 'LinkedIn',
    url: `${LINKEDIN_API_BASE}/rest/images`,
    query: { action: 'initializeUpload' },
    headers: restHeaders(token),
    json: { initializeUploadRequest: { owner } },
    schema: imageInitSchema,
  }).catch(mapForbidden);
  const bytes = await readMediaRange(url, 0, sizeBytes - 1);
  await httpRequest({
    label: 'LinkedIn',
    method: 'PUT',
    url: init.data.value.uploadUrl,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  return init.data.value.image;
}

export const linkedinConnector: Connector = {
  platform: 'linkedin',
  capabilities: {
    publish: true,
    video: true,
    image: true,
    mediaTransfer: 'push_bytes',
    ratios: ['4:5', '1:1', '9:16', '16:9'],
    metrics: false,
    privateReply: false,
    maxCaptionLength: 3000,
    clickableLinks: true,
  },

  async publish({ account, media, caption, title }: PublishInput): Promise<PublishResult> {
    if (!media.sizeBytes) throw new ConnectorError('NO_MEDIA', 'The file size is unknown; LinkedIn needs it to upload.');
    const owner = account.externalAccountId;
    const token = account.accessToken;
    const mediaUrn =
      media.kind === 'video'
        ? await uploadVideo(owner, token, media.url, media.sizeBytes)
        : await uploadImage(owner, token, media.url, media.sizeBytes);
    const res = await httpRequest({
      label: 'LinkedIn',
      url: `${LINKEDIN_API_BASE}/rest/posts`,
      headers: restHeaders(token),
      json: {
        author: owner,
        commentary: escapeLinkedInText(caption).slice(0, 3000),
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { id: mediaUrn, title: title.slice(0, 200) } },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    }).catch(mapForbidden);
    const urn = res.headers.get('x-restli-id');
    if (!urn) throw new ConnectorError('PLATFORM_ERROR', 'LinkedIn did not return the post id.');
    return { externalId: urn, liveUrl: `https://www.linkedin.com/feed/update/${urn}/` };
  },

  fetchMetrics() {
    return Promise.reject(new ConnectorError('UNSUPPORTED_FORMAT', 'LinkedIn post metrics are not available to this app yet.'));
  },
};
