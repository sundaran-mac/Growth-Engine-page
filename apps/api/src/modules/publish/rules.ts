/**
 * Pure publish rules: tracked UTM links, the starting best-window rule, how a channel posts,
 * the preferred asset per platform and the format line. No database access here.
 */
import {
  type BriefKind,
  type ChannelAction,
  type ChannelStatus,
  CONTENT_MODE_LABELS,
  type ContentMode,
  type Platform,
  type PublishHow,
  type Ratio,
  type TrackedLink,
} from '@growth-desk/contract';
import { zonedParts, zonedTimeToUtc } from '../../lib/time.js';

/* ---------- Tracked link ---------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `utm_medium` from the brief kind and platform (a vertical video on YouTube is a short). */
export function utmMedium(kind: BriefKind, platform: Platform): string {
  if (kind === 'reel') return platform === 'youtube' ? 'short' : 'reel';
  if (kind === 'poster') return 'post';
  return kind;
}

export interface TrackedLinkInput {
  /** `product_settings.tracking_base_url`, else env TRACKING_LINK_BASE. */
  baseUrl: string;
  /** `product_settings.utm_campaign_prefix`, else the product slug. */
  campaignPrefix: string;
  platform: Platform;
  kind: BriefKind;
  mode: ContentMode;
  briefCode: string;
  /** The month in the campaign name comes from this date (post time, else now). */
  when: Date;
  timeZone: string;
}

/**
 * Example: `live.humini.app` + live + M1 + REEL-031 + October gives
 * `https://live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031`.
 */
export function buildTrackedLink(input: TrackedLinkInput): TrackedLink {
  const raw = input.baseUrl.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  if (url.pathname === '') url.pathname = '/';
  const month = MONTHS[zonedParts(input.when, input.timeZone).month - 1] ?? 'jan';
  const params = {
    utm_source: input.platform,
    utm_medium: utmMedium(input.kind, input.platform),
    utm_campaign: [slugify(input.campaignPrefix), slugify(CONTENT_MODE_LABELS[input.mode]), month]
      .filter(Boolean)
      .join('-'),
    utm_content: input.briefCode,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const full = url.toString();
  return { url: full, display: full.replace(/^https?:\/\//i, ''), params };
}

/* ---------- Best window (starting rule) ---------- */

/** Weeks 1 to 4: reels 6 to 9 am or 7 to 10 pm, audience local time. We aim inside each window. */
export const STARTING_WINDOW_TIMES = ['06:30', '19:30'] as const;
export const BEST_WINDOW_TEXT =
  'Weeks 1 to 4 use the starting rule: reels 6 to 9 am or 7 to 10 pm, audience local time. From week 5, Growth Desk replaces it with our own best window per channel and audience.';
/** Never schedule closer than this to now, so the worker has time to pick it up. */
export const MIN_LEAD_MS = 15 * 60_000;

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Next start in the starting window rule, at or after `from` plus the lead time, not before the
 * launch date, and not equal to a time already taken on the same channel.
 */
export function nextBestWindow(input: {
  from: Date;
  timeZone: string;
  launchDate?: string | null;
  taken?: readonly Date[];
  /** Local times to aim at each day. Default: the starting rule. A learned window passes its own. */
  times?: readonly string[];
}): Date {
  const times = input.times && input.times.length > 0 ? input.times : STARTING_WINDOW_TIMES;
  const earliest = input.from.getTime() + MIN_LEAD_MS;
  const p = zonedParts(new Date(earliest), input.timeZone);
  let day = `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (input.launchDate && input.launchDate > day) day = input.launchDate;
  const taken = new Set((input.taken ?? []).map((d) => d.getTime()));
  for (let i = 0; i < 60; i += 1) {
    for (const t of times) {
      const at = zonedTimeToUtc(day, t, input.timeZone);
      if (at.getTime() >= earliest && !taken.has(at.getTime())) return at;
    }
    day = addDaysKey(day, 1);
  }
  // Every slot for 60 days is taken: fall back to the first window after the lead time.
  return zonedTimeToUtc(addDaysKey(day, 1), times[times.length - 1]!, input.timeZone);
}

/* ---------- How a channel posts ---------- */

export interface ChannelForHow {
  platform: Platform;
  status: ChannelStatus;
  hasToken: boolean;
  allowedActions: readonly ChannelAction[];
  expiresAt: Date | null;
  /** A refresh token exists, so an expired access token is renewed before use. */
  canRefresh: boolean;
}

/**
 * WhatsApp and manual channels are reminders. A channel marked connected with no token, or an
 * expired token, is not connected. A connected channel without the publish action needs approval.
 */
export function channelHow(c: ChannelForHow, now: Date = new Date()): PublishHow {
  if (c.platform === 'whatsapp' || c.status === 'manual') return 'reminder';
  if (c.status === 'needs_approval') return 'needs_approval';
  if (c.status === 'disconnected') return 'not_connected';
  if (!c.hasToken) return 'not_connected';
  if (c.expiresAt && c.expiresAt.getTime() <= now.getTime() && !c.canRefresh) return 'not_connected';
  if (!c.allowedActions.includes('publish')) return 'needs_approval';
  return 'auto';
}

/* ---------- Asset choice and format ---------- */

export interface AssetForChoice {
  id: string;
  kind: 'video' | 'poster' | 'caption' | 'cutdown';
  ratio: Ratio | null;
  createdAt: Date;
}

/**
 * Best ready asset for a platform: a cut-down or master in the preferred ratio first, then the
 * other accepted ratios, then the master video, then a poster. Newest wins a tie.
 */
export function chooseAsset<T extends AssetForChoice>(assets: readonly T[], ratios: readonly Ratio[]): T | null {
  const media = assets.filter((a) => a.kind !== 'caption');
  if (media.length === 0) return null;
  const newest = (list: T[]) => [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  for (const ratio of ratios) {
    const video = newest(media.filter((a) => (a.kind === 'video' || a.kind === 'cutdown') && a.ratio === ratio));
    if (video) return video;
  }
  const master = newest(media.filter((a) => a.kind === 'video'));
  if (master) return master;
  for (const ratio of ratios) {
    const poster = newest(media.filter((a) => a.kind === 'poster' && a.ratio === ratio));
    if (poster) return poster;
  }
  return newest(media.filter((a) => a.kind === 'poster'));
}

/** Format line as on the Figma: `9:16 · 58 s`, or just the ratio. */
export function formatLine(ratio: Ratio | null, durationMs: number | null): string | null {
  if (!ratio && durationMs === null) return null;
  const secs = durationMs !== null ? `${Math.round(durationMs / 1000)} s` : null;
  return [ratio, secs].filter(Boolean).join(' · ');
}

/** Caption: hook and ask, plus the tracked link where links are clickable. */
export function buildCaption(input: {
  hook: string | null;
  ask: string | null;
  trackedUrl: string | null;
  clickableLinks: boolean;
  maxLength: number;
}): string {
  const parts = [input.hook?.trim(), input.ask?.trim()].filter((s): s is string => Boolean(s));
  if (input.trackedUrl) parts.push(input.clickableLinks ? input.trackedUrl : 'Link in bio.');
  return parts.join('\n\n').slice(0, input.maxLength);
}
