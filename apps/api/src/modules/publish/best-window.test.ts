import { describe, expect, it } from 'vitest';
import { computeValueScore, type Platform, type ValueScoreInput } from '@growth-desk/contract';
import {
  LEARN_MIN_WEEKS,
  learnBestWindows,
  learnWindow,
  learnedKey,
  learnedWindowTimes,
  windowLabel,
  type PublishedObservation,
} from './best-window.js';
import { BEST_WINDOW_TEXT, nextBestWindow, MIN_LEAD_MS } from './rules.js';
import { describeBestWindows } from './service.js';

const IST = 'Asia/Kolkata';
const M = (reach: number, saves = 0, installs = 0): ValueScoreInput => ({
  reach,
  saves,
  shares: 0,
  clicks: 0,
  installs,
  activations: 0,
});

/** A post on a Monday `weeksAgo` of 2026-10-12, at local `hour`:30 in IST (UTC+5:30). */
function obs(
  weeksAgo: number,
  hour: number,
  totals: ValueScoreInput,
  platform: Platform = 'instagram',
  audienceTz = IST,
): PublishedObservation {
  const localMidnightUtc = Date.UTC(2026, 9, 12) - weeksAgo * 7 * 86_400_000 - 5.5 * 3_600_000;
  return { platform, audienceTz, publishedAt: new Date(localMidnightUtc + (hour + 0.5) * 3_600_000), totals };
}

describe('learnWindow', () => {
  it('stays on the starting rule with fewer than 4 weeks of measured posts', () => {
    const data = [0, 1, 2].flatMap((w) => [obs(w, 19, M(1000, 50)), obs(w, 7, M(1000, 5))]);
    expect(LEARN_MIN_WEEKS).toBe(4);
    expect(learnWindow('instagram', IST, data)).toBeNull();
  });

  it('ignores posts with no reach when counting weeks', () => {
    const data = [0, 1, 2].flatMap((w) => [obs(w, 19, M(1000, 50))]).concat(obs(3, 19, M(0)));
    expect(learnWindow('instagram', IST, data)).toBeNull();
  });

  it('picks the 2 hour window with the best value per 1k reach (computeValueScore)', () => {
    const data = [0, 1, 2, 3].flatMap((w) => [
      obs(w, 19, M(1000, 30)), // evening: 90 per 1k
      obs(w, 7, M(2000, 20)), // morning: 30 per 1k
    ]);
    const w = learnWindow('instagram', IST, data)!;
    expect(w).toMatchObject({ platform: 'instagram', audienceTz: IST, posts: 4, weeks: 4 });
    // 18:00 to 20:00 and 19:00 to 21:00 both hold only the 19:xx posts: same value, same
    // reach, so the earlier hour wins.
    expect(w.startHour).toBe(18);
    expect(w.endHour).toBe(20);
    expect(w.valuePer1kReach).toBe(computeValueScore(M(4000, 120)));
    expect(windowLabel(w)).toBe('18:00 to 20:00');
    expect(learnedWindowTimes(w)).toEqual(['18:30']);
  });

  it('a single lucky post never forms a window: a window needs 2 measured posts', () => {
    const data = [0, 1, 2, 3].map((w) => obs(w, 12, M(5000, 100))); // noon: 60 per 1k
    data.push(obs(0, 3, M(10, 5))); // 3 am: 1500 per 1k, but only one post
    const w = learnWindow('instagram', IST, data)!;
    expect(w.startHour).toBe(11);
    expect(w.valuePer1kReach).toBe(60);
    // A second 3 am post makes it a real window, and its value wins.
    data.push(obs(1, 3, M(10, 5)));
    expect(learnWindow('instagram', IST, data)!.startHour).toBe(2);
  });

  it('can wrap a window across midnight and reads hours in the audience zone', () => {
    const sg = 'Asia/Singapore';
    const data = [0, 1, 2, 3].map((w) => {
      // 23:30 Singapore time = 15:30 UTC.
      const at = new Date(Date.UTC(2026, 9, 12) - w * 7 * 86_400_000 + 15.5 * 3_600_000);
      return { platform: 'youtube' as const, audienceTz: sg, publishedAt: at, totals: M(500, 10) };
    });
    const w = learnWindow('youtube', sg, data)!;
    expect(w.startHour).toBe(22);
    // Half the posts at 23:30, half at 00:30: only 23:00 to 01:00 holds them all.
    const late = learnWindow(
      'youtube',
      sg,
      data.map((o, i) => (i % 2 ? { ...o, publishedAt: new Date(o.publishedAt.getTime() + 3_600_000) } : o)),
    )!;
    expect(late).toMatchObject({ startHour: 23, endHour: 1 });
  });
});

describe('learnBestWindows', () => {
  it('learns per platform and audience zone separately', () => {
    const data = [0, 1, 2, 3].flatMap((w) => [
      obs(w, 19, M(1000, 30)),
      obs(w, 19, M(1000, 30)),
      obs(w, 8, M(1000, 30), 'linkedin'),
      obs(w, 8, M(1000, 30), 'linkedin'),
    ]);
    data.push(obs(0, 9, M(1000, 30), 'instagram', 'Europe/London'));
    const all = learnBestWindows(data);
    expect([...all.keys()].sort()).toEqual([learnedKey('instagram', IST), learnedKey('linkedin', IST)]);
    expect(all.get(learnedKey('linkedin', IST))!.startHour).toBe(7);
  });
});

describe('nextBestWindow with a learned time', () => {
  it('aims at the learned window instead of the starting times', () => {
    const from = new Date('2026-10-12T00:00:00Z'); // 05:30 IST
    const at = nextBestWindow({ from, timeZone: IST, times: ['14:30'] });
    expect(at.toISOString()).toBe('2026-10-12T09:00:00.000Z'); // 14:30 IST
    expect(at.getTime()).toBeGreaterThanOrEqual(from.getTime() + MIN_LEAD_MS);
    const next = nextBestWindow({ from, timeZone: IST, times: ['14:30'], taken: [at] });
    expect(next.toISOString()).toBe('2026-10-13T09:00:00.000Z');
  });
});

describe('describeBestWindows', () => {
  it('says starting when nothing is learned', () => {
    const d = describeBestWindows(['instagram', 'whatsapp'], IST, new Map());
    expect(d.rule).toBe('starting');
    expect(d.text).toBe(BEST_WINDOW_TEXT);
    expect(d.windows.map((w) => w.rule)).toEqual(['starting', 'starting']);
  });

  it('says learned with the window and value, and lists channels still starting', () => {
    const learned = learnBestWindows(
      [0, 1, 2, 3].flatMap((w) => [obs(w, 19, M(1000, 30)), obs(w, 19, M(1000, 30))]),
    );
    const d = describeBestWindows(['instagram', 'linkedin', 'instagram'], IST, learned);
    expect(d.rule).toBe('learned');
    expect(d.windows).toHaveLength(2);
    expect(d.windows[0]).toMatchObject({ platform: 'instagram', rule: 'learned', startHour: 18, endHour: 20, posts: 8 });
    expect(d.windows[1]).toMatchObject({ platform: 'linkedin', rule: 'starting', startHour: null });
    expect(d.text).toContain('Instagram 18:00 to 20:00 (90 value per 1k reach)');
    expect(d.text).toContain('Still on the starting rule (6 to 9 am or 7 to 10 pm): LinkedIn.');
  });
});
