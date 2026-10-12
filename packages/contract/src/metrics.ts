/**
 * Value score (BUILD-PLAN section 5):
 * (saves*3 + shares*4 + clicks*5 + installs*20 + activations*40) / reach * 1000.
 * Returns 0 when reach is 0. Rounded to 2 decimals.
 */
export interface ValueScoreInput {
  reach: number;
  saves: number;
  shares: number;
  clicks: number;
  installs: number;
  activations: number;
}

export const VALUE_SCORE_WEIGHTS = {
  saves: 3,
  shares: 4,
  clicks: 5,
  installs: 20,
  activations: 40,
} as const;

export function computeValueScore(m: ValueScoreInput): number {
  if (m.reach <= 0) return 0;
  const w = VALUE_SCORE_WEIGHTS;
  const points =
    m.saves * w.saves +
    m.shares * w.shares +
    m.clicks * w.clicks +
    m.installs * w.installs +
    m.activations * w.activations;
  return Math.round((points / m.reach) * 1000 * 100) / 100;
}
