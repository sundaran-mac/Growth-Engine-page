/**
 * Cross-module functions of the IDEAS module. Signatures fixed by the lead; SETTINGS' weekly run
 * calls them. The work lives in `generation.ts`.
 */
import type { ContentMode, Idea, Platform } from '@growth-desk/contract';
import { generateIdeasDetailed, reviewOpenIdeas } from './generation.js';

export interface GenerateIdeasOptions {
  count: number;
  modes?: ContentMode[];
  channels?: Platform[];
  source: 'manual' | 'weekly';
  weeklyRunId?: string;
}

/**
 * Asks Claude for ideas using `buildProductContext`, lints them, stores them as `new`.
 * Throws FEATURE_DISABLED (503) when Claude is not connected and CLAUDE_CAP_REACHED (429)
 * when the product's monthly budget is used up. Ideas that fail the lint are dropped.
 */
export async function generateIdeas(productId: string, opts: GenerateIdeasOptions, actorId: string | null): Promise<Idea[]> {
  const result = await generateIdeasDetailed(productId, opts, actorId);
  return result.ideas;
}

export interface IdeasReviewResult {
  rescored: number;
  flaggedStale: number;
}

/** Re-scores open ideas against the current kit and last week's numbers; flags stale ones. */
export async function reviewIdeas(productId: string): Promise<IdeasReviewResult> {
  return reviewOpenIdeas(productId);
}
