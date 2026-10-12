import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeValueScore } from '@growth-desk/contract';
import {
  addDays,
  buildReplyMessage,
  commentMatchesKeyword,
  dailyFromLifetime,
  daysBetween,
  deltaPct,
  findMatchingRule,
  isMonday,
  isoWeekNumber,
  lastWeekStarts,
  mondayOf,
  pickMoreAndStop,
  verifyMetaSignature,
  windows,
  withValueScore,
  ZERO_TOTALS,
} from './logic.js';

describe('calendar helpers', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-28')).toBe(27);
  });

  it('finds the Monday and ISO week', () => {
    expect(mondayOf('2026-10-13')).toBe('2026-10-12');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12'); // Sunday belongs to the week before
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(isMonday('2026-10-12')).toBe(true);
    expect(isMonday('2026-10-13')).toBe(false);
    expect(isoWeekNumber('2026-10-12')).toBe(42);
    expect(isoWeekNumber('2026-01-01')).toBe(1);
    expect(isoWeekNumber('2027-01-01')).toBe(53);
  });

  it('builds the current and previous windows', () => {
    const { current, previous } = windows('2026-10-12', 7);
    expect(current).toEqual({ from: '2026-10-06', to: '2026-10-12', days: 7 });
    expect(previous).toEqual({ from: '2026-09-29', to: '2026-10-05', days: 7 });
  });

  it('lists week starts oldest first', () => {
    expect(lastWeekStarts('2026-10-14', 3)).toEqual(['2026-09-28', '2026-10-05', '2026-10-12']);
  });
});

describe('numbers', () => {
  it('uses the contract value score on summed totals', () => {
    const t = {
      ...ZERO_TOTALS,
      reach: 2000,
      saves: 10,
      shares: 5,
      clicks: 4,
      installs: 2,
      activations: 1,
    };
    // (30 + 20 + 20 + 40 + 40) / 2000 * 1000 = 75
    expect(withValueScore(t).valueScore).toBe(75);
    expect(withValueScore(t).valueScore).toBe(computeValueScore(t));
    expect(withValueScore(ZERO_TOTALS).valueScore).toBe(0);
  });

  it('computes deltas and refuses a zero base', () => {
    expect(deltaPct(112, 100)).toBe(12);
    expect(deltaPct(50, 100)).toBe(-50);
    expect(deltaPct(10, 0)).toBeNull();
  });

  it('turns lifetime totals into a daily value, never negative', () => {
    const before = { ...ZERO_TOTALS, reach: 900, saves: 10 };
    const daily = dailyFromLifetime({ reach: 1000, saves: 8, installs: 3 }, before);
    expect(daily).toEqual({ ...ZERO_TOTALS, reach: 100, saves: 0, installs: 3 });
  });
});

describe('keyword matching', () => {
  it('matches whole words in any case', () => {
    expect(commentMatchesKeyword('circle please!', 'CIRCLE')).toBe(true);
    expect(commentMatchesKeyword('Send me the CIRCLE link', 'circle')).toBe(true);
    expect(commentMatchesKeyword('encircled', 'CIRCLE')).toBe(false);
    expect(commentMatchesKeyword('வணக்கம் CIRCLE', 'CIRCLE')).toBe(true);
  });

  it('picks the first matching rule', () => {
    const rules = [{ keyword: 'LINK' }, { keyword: 'CIRCLE' }];
    expect(findMatchingRule('circle', rules)).toEqual({ keyword: 'CIRCLE' });
    expect(findMatchingRule('hello', rules)).toBeNull();
  });

  it('adds the link once', () => {
    expect(buildReplyMessage('Here you go', 'https://x.app/?a=1')).toBe(
      'Here you go\nhttps://x.app/?a=1',
    );
    expect(buildReplyMessage('Here: https://x.app', 'https://x.app')).toBe('Here: https://x.app');
    expect(buildReplyMessage('Thanks', null)).toBe('Thanks');
  });
});

describe('Meta signature', () => {
  const body = Buffer.from('{"object":"instagram"}');
  const sig = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;

  it('accepts the right signature and rejects others', () => {
    expect(verifyMetaSignature(body, sig, 'secret')).toBe(true);
    expect(verifyMetaSignature(body, sig, 'other')).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{}'), sig, 'secret')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'secret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha1=abc', 'secret')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=zz', 'secret')).toBe(false);
  });
});

describe('Monday note picks', () => {
  it('picks the best and worst mode with reach', () => {
    const r = pickMoreAndStop([
      { mode: 'M1', label: 'M1', pieces: 2, reach: 1000, valuePer1k: 86 },
      { mode: 'M3', label: 'M3', pieces: 1, reach: 800, valuePer1k: 58 },
      { mode: 'M4', label: 'M4', pieces: 1, reach: 0, valuePer1k: 0 },
    ]);
    expect(r.more?.mode).toBe('M1');
    expect(r.stop?.mode).toBe('M3');
  });

  it('returns nothing to stop with one mode, nothing at all with none', () => {
    expect(
      pickMoreAndStop([{ mode: 'M1', label: 'M1', pieces: 1, reach: 5, valuePer1k: 1 }]).stop,
    ).toBeNull();
    expect(pickMoreAndStop([])).toEqual({ more: null, stop: null });
  });
});
