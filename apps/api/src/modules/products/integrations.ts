/**
 * GET /integrations/status: the real state of every connection on the Integrations screen.
 *
 * Honest by design (spec 001, section 4 screen 12 and BUILD-PLAN section 4):
 * - A social account is `connected` only when a token is stored. A row that says connected
 *   with no token shows as `disconnected` ("Not connected").
 * - WhatsApp is always `manual` (no API route for Channels).
 * - Claude, GitHub and storage follow the env feature flags, not the stored row.
 * - A stored `connected` for a tool this version has no connection for shows as `not_set_up`.
 * Tokens never leave the server: only `hasToken` is reported.
 */
import { asc } from 'drizzle-orm';
import {
  PLATFORM_LABELS,
  PLATFORMS,
  type ChannelStatus,
  type IntegrationChannel,
  type IntegrationStatus,
  type IntegrationsStatusResponse,
  type IntegrationTool,
  type Platform,
} from '@growth-desk/contract';
import { env, type AppEnv } from '../../config/env.js';
import { db } from '../../db/client.js';
import { channelAccounts, integrations } from '../../db/schema/index.js';
import { iso } from '../../lib/time.js';

type AccountRow = typeof channelAccounts.$inferSelect;
type IntegrationRow = typeof integrations.$inferSelect;

const DEFAULT_DESCRIPTIONS: Record<Platform, string> = {
  instagram: 'Publish, insights, comments',
  facebook: 'Publish, insights',
  youtube: 'Shorts, long video, analytics',
  linkedin: 'Posts for people and company pages',
  whatsapp: 'Channel by hand · Business API for opt-in',
};

export function oauthConfigured(platform: Platform, features: AppEnv['features']): boolean {
  switch (platform) {
    case 'instagram':
    case 'facebook':
      return features.meta;
    case 'youtube':
      return features.google;
    case 'linkedin':
      return features.linkedin;
    case 'whatsapp':
      return false;
  }
}

/** The state we can stand behind for one account row. */
export function effectiveChannelStatus(
  row: Pick<AccountRow, 'platform' | 'status' | 'accessTokenEnc'>,
): ChannelStatus {
  if (row.platform === 'whatsapp') return 'manual';
  if (row.status === 'connected' && !row.accessTokenEnc) return 'disconnected';
  return row.status;
}

export function channelRows(
  accounts: AccountRow[],
  features: AppEnv['features'],
): IntegrationChannel[] {
  const rows: IntegrationChannel[] = [];
  for (const platform of PLATFORMS) {
    const own = accounts.filter((a) => a.platform === platform);
    if (own.length === 0) {
      rows.push({
        id: null,
        platform,
        displayName: PLATFORM_LABELS[platform],
        description: DEFAULT_DESCRIPTIONS[platform],
        handle: null,
        status: platform === 'whatsapp' ? 'manual' : 'disconnected',
        hasToken: false,
        allowedActions: [],
        expiresAt: null,
        lastError: null,
        connectedAt: null,
        oauthConfigured: oauthConfigured(platform, features),
        canConnect: platform !== 'whatsapp',
      });
      continue;
    }
    for (const a of own) {
      const status = effectiveChannelStatus(a);
      const hasToken = Boolean(a.accessTokenEnc);
      rows.push({
        id: a.id,
        platform,
        displayName: a.displayName,
        description: a.description,
        handle: a.handle,
        status,
        hasToken,
        // Without a token nothing can be done through the API, whatever the row says.
        allowedActions: hasToken ? a.allowedActions : [],
        expiresAt: iso(a.expiresAt),
        lastError: a.lastError,
        connectedAt: hasToken ? iso(a.connectedAt) : null,
        oauthConfigured: oauthConfigured(platform, features),
        canConnect: platform !== 'whatsapp',
      });
    }
  }
  return rows;
}

interface FlaggedTool {
  on: boolean;
  onDetail: string;
  offDetail: string;
}

function flaggedTools(e: AppEnv): Record<string, FlaggedTool> {
  return {
    claude: {
      on: e.features.claude,
      onDetail: `ANTHROPIC_API_KEY is set · model ${e.anthropicModel}`,
      offDetail: 'Set ANTHROPIC_API_KEY to turn on ideas, briefs, captions and notes.',
    },
    github: {
      on: e.features.github,
      onDetail: 'GITHUB_TOKEN is set',
      offDetail: 'Set GITHUB_TOKEN to refresh kits from repos and open weekly PRs.',
    },
    storage: {
      on: e.features.storage,
      onDetail:
        e.storage?.driver === 'minio'
          ? 'Local MinIO (development). Social platforms cannot fetch files from it.'
          : 'Cloudflare R2 is set',
      offDetail:
        'Set the R2 keys (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).',
    },
  };
}

/** Figma order of the tool cards (242:1642). Unknown keys go last, by name. */
const TOOL_ORDER = [
  'claude',
  'github',
  'google-drive',
  'hand-off-tools',
  'analytics',
  'hubspot',
  'comment-to-dm',
  'storage',
];

const STATUS_DETAIL: Record<IntegrationStatus, string | null> = {
  connected: null,
  hand_off: 'Made in the tool, then handed back to Growth Desk.',
  check_first: 'Check the vendor’s current docs before building on it.',
  not_set_up: 'Not set up yet.',
  disabled: 'Turned off.',
};

export function toolRows(rows: IntegrationRow[], e: AppEnv): IntegrationTool[] {
  const flags = flaggedTools(e);
  const tools: IntegrationTool[] = rows.map((r) => {
    const flag = flags[r.key];
    if (flag) {
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        status: flag.on ? 'connected' : 'not_set_up',
        detail: flag.on ? flag.onDetail : flag.offDetail,
      };
    }
    if (r.status === 'connected') {
      return {
        key: r.key,
        name: r.name,
        description: r.description,
        status: 'not_set_up',
        detail: 'No connection for this is built in this version yet.',
      };
    }
    return {
      key: r.key,
      name: r.name,
      description: r.description,
      status: r.status,
      detail: STATUS_DETAIL[r.status],
    };
  });
  for (const key of Object.keys(flags)) {
    if (tools.some((t) => t.key === key)) continue;
    const flag = flags[key]!;
    tools.push({
      key,
      name: key === 'storage' ? 'Storage (R2)' : key === 'claude' ? 'Claude' : 'GitHub',
      description:
        key === 'storage'
          ? 'Video, posters and documents'
          : key === 'claude'
            ? 'Ideas, briefs, captions, notes'
            : 'Repos, briefs, approvals as PRs',
      status: flag.on ? 'connected' : 'not_set_up',
      detail: flag.on ? flag.onDetail : flag.offDetail,
    });
  }
  const rank = (key: string) => {
    const i = TOOL_ORDER.indexOf(key);
    return i === -1 ? TOOL_ORDER.length : i;
  };
  return tools.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
}

export async function integrationsStatus(e: AppEnv = env): Promise<IntegrationsStatusResponse> {
  const [accounts, tools] = await Promise.all([
    db.select().from(channelAccounts).orderBy(asc(channelAccounts.createdAt)),
    db.select().from(integrations).orderBy(asc(integrations.createdAt), asc(integrations.name)),
  ]);
  return { channels: channelRows(accounts, e.features), tools: toolRows(tools, e) };
}
