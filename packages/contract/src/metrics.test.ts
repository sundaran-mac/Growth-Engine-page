import { describe, expect, it } from 'vitest';
import { computeValueScore } from './metrics.js';
import { BRIEF_STAGE_TRANSITIONS, BRIEF_STAGES, canMoveBriefStage } from './enums.js';
import { loginRequestSchema } from './auth.js';
import { paginationQuerySchema } from './common.js';

describe('computeValueScore', () => {
  it('weights each step of the ladder per 1,000 reach', () => {
    expect(
      computeValueScore({
        reach: 1000,
        saves: 1,
        shares: 1,
        clicks: 1,
        installs: 1,
        activations: 1,
      }),
    ).toBe(72);
  });
  it('returns 0 when reach is 0', () => {
    expect(
      computeValueScore({ reach: 0, saves: 5, shares: 0, clicks: 0, installs: 0, activations: 0 }),
    ).toBe(0);
  });
});

describe('brief stage machine', () => {
  it('moves forward one step at a time', () => {
    for (let i = 0; i < BRIEF_STAGES.length - 1; i++) {
      expect(canMoveBriefStage(BRIEF_STAGES[i]!, BRIEF_STAGES[i + 1]!)).toBe(true);
    }
  });
  it('blocks skipping the gates', () => {
    expect(canMoveBriefStage('made', 'approved')).toBe(false);
    expect(canMoveBriefStage('brief', 'scheduled')).toBe(false);
  });
  it('has a rule for every stage', () => {
    expect(Object.keys(BRIEF_STAGE_TRANSITIONS).sort()).toEqual([...BRIEF_STAGES].sort());
  });
});

describe('shared schemas', () => {
  it('normalises the login email', () => {
    expect(loginRequestSchema.parse({ email: ' Jeeva@Example.COM ', password: 'x' }).email).toBe(
      'jeeva@example.com',
    );
  });
  it('caps the page size at 100', () => {
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });
});
