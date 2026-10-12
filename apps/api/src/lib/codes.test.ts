import { beforeEach, describe, expect, it } from 'vitest';
import { truncateAll } from '../../test/helpers.js';
import { bumpBriefCodeCounter, formatBriefCode, nextBriefCode, parseBriefCode } from './codes.js';

describe('brief codes', () => {
  beforeEach(truncateAll);

  it('formats and parses codes', () => {
    expect(formatBriefCode('REEL', 31)).toBe('REEL-031');
    expect(formatBriefCode('POSTER', 1234)).toBe('POSTER-1234');
    expect(parseBriefCode('REEL-031')).toEqual({ prefix: 'REEL', value: 31 });
    expect(parseBriefCode('reel-31')).toBeNull();
    expect(() => formatBriefCode('REEL', 0)).toThrow();
  });

  it('counts per kind, starting at 001', async () => {
    expect(await nextBriefCode('reel')).toBe('REEL-001');
    expect(await nextBriefCode('reel')).toBe('REEL-002');
    expect(await nextBriefCode('poster')).toBe('POSTER-001');
  });

  it('continues after the highest seeded code', async () => {
    await bumpBriefCodeCounter('REEL', 31);
    await bumpBriefCodeCounter('REEL', 12);
    expect(await nextBriefCode('reel')).toBe('REEL-032');
  });

  it('never hands out the same code twice under concurrency', async () => {
    const codes = await Promise.all(Array.from({ length: 25 }, () => nextBriefCode('short')));
    expect(new Set(codes).size).toBe(25);
  });
});
