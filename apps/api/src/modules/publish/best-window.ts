/**
 * Learned best window (from week 5). Pure functions, no database.
 *
 * Weeks 1 to 4 use the starting rule (rules.ts). Once a platform has published posts with
 * metric snapshots in at least LEARN_MIN_WEEKS different weeks for one audience time zone, we
 * pick the 2 hour window (audience local time) whose posts earned the most value per 1k reach.
 * Value per 1k reach is `computeValueScore` over the summed metrics of the posts in the window,
 * so a window with more reach weighs more than one lucky post.
 */
import { DateTime } from 'luxon';
import { computeValueScore, type Platform, type ValueScoreInput } from '@growth-desk/contract';

export const LEARN_MIN_WEEKS = 4;
export const WINDOW_HOURS = 2;
/** A window needs at least this many measured posts to be trusted. */
export const MIN_POSTS_PER_WINDOW = 2;

export interface PublishedObservation {
  platform: Platform;
  audienceTz: string;
  publishedAt: Date;
  /** Sum of the post's daily metric snapshots. */
  totals: ValueScoreInput;
}

export interface LearnedWindow {
  platform: Platform;
  audienceTz: string;
  /** Local start hour, 0 to 23. The window is [startHour, startHour + 2) and may cross midnight. */
  startHour: number;
  endHour: number;
  valuePer1kReach: number;
  posts: number;
  weeks: number;
}

export const learnedKey = (platform: Platform, audienceTz: string) => `${platform}|${audienceTz}`;

function addTotals(a: ValueScoreInput, b: ValueScoreInput): ValueScoreInput {
  return {
    reach: a.reach + b.reach,
    saves: a.saves + b.saves,
    shares: a.shares + b.shares,
    clicks: a.clicks + b.clicks,
    installs: a.installs + b.installs,
    activations: a.activations + b.activations,
  };
}

const ZERO: ValueScoreInput = { reach: 0, saves: 0, shares: 0, clicks: 0, installs: 0, activations: 0 };

/** Best window of one platform and audience zone, or null while it is still learning. */
export function learnWindow(
  platform: Platform,
  audienceTz: string,
  observations: readonly PublishedObservation[],
): LearnedWindow | null {
  const measured = observations.filter(
    (o) => o.platform === platform && o.audienceTz === audienceTz && o.totals.reach > 0,
  );
  const weeks = new Set<string>();
  const byHour: { totals: ValueScoreInput; posts: number }[] = Array.from({ length: 24 }, () => ({
    totals: ZERO,
    posts: 0,
  }));
  for (const o of measured) {
    const local = DateTime.fromJSDate(o.publishedAt, { zone: audienceTz });
    if (!local.isValid) continue;
    weeks.add(`${local.weekYear}-W${local.weekNumber}`);
    const cell = byHour[local.hour]!;
    cell.totals = addTotals(cell.totals, o.totals);
    cell.posts += 1;
  }
  if (weeks.size < LEARN_MIN_WEEKS) return null;

  let best: LearnedWindow | null = null;
  let bestReach = 0;
  for (let start = 0; start < 24; start += 1) {
    let totals = ZERO;
    let posts = 0;
    for (let k = 0; k < WINDOW_HOURS; k += 1) {
      const cell = byHour[(start + k) % 24]!;
      totals = addTotals(totals, cell.totals);
      posts += cell.posts;
    }
    if (posts < MIN_POSTS_PER_WINDOW || totals.reach <= 0) continue;
    const value = computeValueScore(totals);
    // Higher value wins; on a tie more reach (more evidence), then the earlier hour.
    if (!best || value > best.valuePer1kReach || (value === best.valuePer1kReach && totals.reach > bestReach)) {
      best = {
        platform,
        audienceTz,
        startHour: start,
        endHour: (start + WINDOW_HOURS) % 24,
        valuePer1kReach: value,
        posts,
        weeks: weeks.size,
      };
      bestReach = totals.reach;
    }
  }
  return best;
}

/** Learned windows for every platform and audience zone seen in the observations. */
export function learnBestWindows(observations: readonly PublishedObservation[]): Map<string, LearnedWindow> {
  const groups = new Map<string, { platform: Platform; tz: string }>();
  for (const o of observations) groups.set(learnedKey(o.platform, o.audienceTz), { platform: o.platform, tz: o.audienceTz });
  const out = new Map<string, LearnedWindow>();
  for (const [key, g] of groups) {
    const w = learnWindow(g.platform, g.tz, observations);
    if (w) out.set(key, w);
  }
  return out;
}

/** Where we aim inside a learned window: 30 minutes after it opens, like the starting rule. */
export function learnedWindowTimes(w: Pick<LearnedWindow, 'startHour'>): string[] {
  return [`${String(w.startHour).padStart(2, '0')}:30`];
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** "19:00 to 21:00". */
export function windowLabel(w: Pick<LearnedWindow, 'startHour' | 'endHour'>): string {
  return `${hh(w.startHour)} to ${hh(w.endHour)}`;
}
