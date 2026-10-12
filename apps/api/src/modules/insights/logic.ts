/**
 * Pure helpers for the INSIGHTS module (no database, no network). Unit tested in logic.test.ts.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { computeValueScore, type MetricTotals } from '@growth-desk/contract';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ---------- Calendar dates (YYYY-MM-DD) ---------- */

function parseDateKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
  return new Date(parseDateKey(key) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDateKey(b) - parseDateKey(a)) / DAY_MS);
}

export function isMonday(key: string): boolean {
  return new Date(parseDateKey(key)).getUTCDay() === 1;
}

/** Monday of the week holding the calendar date. */
export function mondayOf(key: string): string {
  const dow = new Date(parseDateKey(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((dow + 6) % 7));
}

/** ISO 8601 week number of a calendar date. */
export function isoWeekNumber(key: string): number {
  const date = new Date(parseDateKey(key));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dow + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDow = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDow + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

export interface DateWindow {
  from: string;
  to: string;
  days: number;
}

/** The `days`-long window ending on `today` (inclusive), and the same-length window before it. */
export function windows(
  today: string,
  days: number,
): { current: DateWindow; previous: DateWindow } {
  const from = addDays(today, -(days - 1));
  return {
    current: { from, to: today, days },
    previous: { from: addDays(from, -days), to: addDays(from, -1), days },
  };
}

/** Mondays of the last `count` weeks, oldest first, ending with the week of `today`. */
export function lastWeekStarts(today: string, count: number): string[] {
  const thisMonday = mondayOf(today);
  return Array.from({ length: count }, (_, i) => addDays(thisMonday, -7 * (count - 1 - i)));
}

/* ---------- Numbers ---------- */

export interface RawTotals {
  reach: number;
  saves: number;
  shares: number;
  comments: number;
  clicks: number;
  installs: number;
  activations: number;
}

export const ZERO_TOTALS: RawTotals = {
  reach: 0,
  saves: 0,
  shares: 0,
  comments: 0,
  clicks: 0,
  installs: 0,
  activations: 0,
};

/** Sums of daily values plus the value score of those sums (the plan formula, from the contract). */
export function withValueScore(t: RawTotals): MetricTotals {
  return { ...t, valueScore: computeValueScore(t) };
}

/** Percent change, rounded to a whole number. Null when there is no base to compare with. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Turns lifetime totals from a platform into the daily value for one day:
 * lifetime total minus what earlier daily snapshots already hold. Never negative
 * (platforms sometimes revise numbers down).
 */
export function dailyFromLifetime(lifetime: Partial<RawTotals>, before: RawTotals): RawTotals {
  const pick = (k: keyof RawTotals) => {
    const total = lifetime[k];
    if (total === undefined || !Number.isFinite(total)) return 0;
    return Math.max(0, Math.round(total) - before[k]);
  };
  return {
    reach: pick('reach'),
    saves: pick('saves'),
    shares: pick('shares'),
    comments: pick('comments'),
    clicks: pick('clicks'),
    installs: pick('installs'),
    activations: pick('activations'),
  };
}

/* ---------- Keyword matching ---------- */

/** True when the comment holds the keyword as a whole word (any case). */
export function commentMatchesKeyword(comment: string, keyword: string): boolean {
  const words = comment.toUpperCase().split(/[^\p{L}\p{N}_-]+/u);
  return words.includes(keyword.toUpperCase());
}

/** First rule whose keyword the comment holds, in the given order. */
export function findMatchingRule<R extends { keyword: string }>(
  comment: string,
  rules: readonly R[],
): R | null {
  return rules.find((r) => commentMatchesKeyword(comment, r.keyword)) ?? null;
}

/** Reply text with the link on its own line (when the text does not already hold it). */
export function buildReplyMessage(replyText: string, link: string | null): string {
  if (!link || replyText.includes(link)) return replyText;
  return `${replyText}\n${link}`;
}

/* ---------- Meta webhook signature ---------- */

/** Checks `X-Hub-Signature-256: sha256=<hex>` (HMAC-SHA256 of the raw body with the app secret). */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const actual = Buffer.from(given, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---------- Monday note from numbers ---------- */

export interface ModeWeekNumbers {
  mode: string;
  label: string;
  pieces: number;
  reach: number;
  valuePer1k: number;
}

/**
 * Picks the mode to do more of (best value per 1,000 reach) and the one to stop (worst), from
 * modes with reach. Returns nulls when there is not enough to compare.
 */
export function pickMoreAndStop(modes: readonly ModeWeekNumbers[]): {
  more: ModeWeekNumbers | null;
  stop: ModeWeekNumbers | null;
} {
  const ranked = modes.filter((m) => m.reach > 0).sort((a, b) => b.valuePer1k - a.valuePer1k);
  if (ranked.length === 0) return { more: null, stop: null };
  const more = ranked[0]!;
  const stop = ranked.length > 1 ? ranked[ranked.length - 1]! : null;
  return { more, stop };
}
