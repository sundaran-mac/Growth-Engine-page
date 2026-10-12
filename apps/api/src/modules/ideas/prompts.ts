/**
 * Claude prompts for the Ideas board. Pure functions: they only build text and schemas.
 * Claude drafts ideas and scores; people star, park and brief them. Claude never approves.
 */
import { z } from 'zod';
import {
  CONTENT_MODES,
  CONTENT_MODE_LABELS,
  PLATFORMS,
  PLATFORM_LABELS,
  type ContentMode,
  type Platform,
} from '@growth-desk/contract';

/** Shape Claude must answer with for "generate". Ranges are checked after parsing. */
export const claudeIdeasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string(),
      mode: z.enum(CONTENT_MODES),
      channels: z.array(z.enum(PLATFORMS)),
      fitScore: z.number(),
      why: z.string(),
      /** One of the product's audiences (or a short new one). */
      audience: z.string(),
      /** One of the product's true behaviours (or a short new one). */
      behaviour: z.string(),
      /** The twist that makes this idea new: 2 to 6 plain words. */
      angle: z.string(),
    }),
  ),
});
export type ClaudeIdeas = z.infer<typeof claudeIdeasSchema>;

/** Shape Claude must answer with for the weekly review. */
export const claudeReviewSchema = z.object({
  reviews: z.array(
    z.object({
      id: z.string(),
      fitScore: z.number(),
      stale: z.boolean(),
      reason: z.string(),
    }),
  ),
});
export type ClaudeReview = z.infer<typeof claudeReviewSchema>;

export interface ModeValue {
  mode: ContentMode;
  pieces: number;
  reach: number;
  valueScore: number;
}

export interface PromptOccasion {
  name: string;
  date: string;
  endDate: string | null;
}

export interface GeneratePromptInput {
  productName: string;
  contextText: string;
  neverSay: readonly string[];
  notBuilt: readonly string[];
  lastWeek: readonly ModeValue[];
  occasions: readonly PromptOccasion[];
  usedTitles: readonly string[];
  /** Product kit audiences and true behaviours, for the angle tag. */
  audiences: readonly string[];
  behaviours: readonly string[];
  /** Content memory: coverage map, closest past ideas, unexplored seeds (memory-context.ts). */
  coverageText: string;
  similarPastText: string;
  seedsText: string;
  /** Drafts from earlier rounds of this run that were rejected, with the reason. */
  rejected: readonly { title: string; reason: string }[];
  count: number;
  modes: readonly ContentMode[];
  channels: readonly Platform[];
  today: string;
}

const MODE_LINES = CONTENT_MODES.map((m) => `- ${m} ${CONTENT_MODE_LABELS[m]}`).join('\n');

export const IDEAS_SYSTEM = [
  'You are the idea writer for Growth Desk, the marketing desk of the Humini products.',
  'You draft short social video and poster ideas. People choose which ones to make; you never approve anything.',
  'Rules you must follow:',
  '1. Every idea must be true to the product context. Do not claim a feature that is not built.',
  '2. Never use any phrase from the never-say list, not even in another form.',
  '3. Every idea must be new for every product, forever. Do not repeat, reword or re-angle any idea in the memory lists, for this product or another one.',
  '4. Titles are short and concrete (at most 8 words), in plain English, with no hashtags and no emoji.',
  '5. "why" is one plain sentence (at most 25 words) on why this idea fits now.',
  '6. fitScore is a whole number from 0 to 100: how well the idea fits the product promise, the audience and what worked last week.',
  '7. Do not use the long dash character. Use a comma or a full stop instead.',
  '8. Tag each idea: audience (one of the listed audiences), behaviour (one of the listed behaviours) and angle (the twist that makes it new, 2 to 6 plain words, not used before).',
  '9. Prefer the under-used mixes in the unexplored seed and the thin parts of the coverage map.',
  'Content modes:',
  MODE_LINES,
].join('\n');

function list(items: readonly string[], empty: string): string {
  return items.length > 0 ? items.map((s) => `- ${s}`).join('\n') : empty;
}

export function buildGeneratePrompt(i: GeneratePromptInput): string {
  const modes = i.modes.length > 0 ? i.modes.map((m) => `${m} ${CONTENT_MODE_LABELS[m]}`).join(', ') : 'any mode (spread them)';
  const channels =
    i.channels.length > 0 ? i.channels.map((c) => PLATFORM_LABELS[c]).join(', ') : 'any channel that suits the idea';
  const lastWeek =
    i.lastWeek.length > 0
      ? i.lastWeek
          .map((v) => `- ${v.mode} ${CONTENT_MODE_LABELS[v.mode]}: ${v.pieces} pieces, reach ${v.reach}, value per 1k reach ${v.valueScore}`)
          .join('\n')
      : 'No numbers from last week yet.';
  const occasions = list(
    i.occasions.map((o) => (o.endDate ? `${o.name} (${o.date} to ${o.endDate})` : `${o.name} (${o.date})`)),
    'None in the next six weeks.',
  );
  return [
    `Today is ${i.today}. Draft exactly ${i.count} new ideas for ${i.productName}.`,
    `Modes to use: ${modes}.`,
    `Channels: ${channels}.`,
    '',
    '<product_context>',
    i.contextText.trim() || 'No product context yet.',
    '</product_context>',
    '',
    '<never_say>',
    list(i.neverSay, 'Nothing listed.'),
    '</never_say>',
    '',
    '<not_built_yet>',
    list(i.notBuilt, 'Nothing listed.'),
    '</not_built_yet>',
    '',
    '<last_week_value_by_mode>',
    lastWeek,
    '</last_week_value_by_mode>',
    '',
    '<occasions_next_6_weeks>',
    occasions,
    '</occasions_next_6_weeks>',
    '',
    '<titles_already_used>',
    list(i.usedTitles, 'None yet.'),
    '</titles_already_used>',
    '',
    '<audiences>',
    list(i.audiences, 'Not listed. Use a short audience of your own.'),
    '</audiences>',
    '',
    '<true_behaviours>',
    list(i.behaviours, 'Not listed. Use a short behaviour of your own.'),
    '</true_behaviours>',
    '',
    '<memory_coverage_all_products>',
    i.coverageText,
    '</memory_coverage_all_products>',
    '',
    '<closest_past_ideas_all_products>',
    i.similarPastText,
    '</closest_past_ideas_all_products>',
    '',
    '<unexplored_seed>',
    i.seedsText,
    '</unexplored_seed>',
    '',
    ...(i.rejected.length > 0
      ? [
          '<rejected_in_this_run>',
          list(
            i.rejected.map((r) => `${r.title}: ${r.reason}`),
            '',
          ),
          '</rejected_in_this_run>',
          'These drafts were rejected. Do not send them again or anything close to them.',
          '',
        ]
      : []),
    'Lean towards the modes with the best value per 1k reach, but keep some variety.',
    'Answer with JSON only.',
  ].join('\n');
}

export interface ReviewPromptIdea {
  id: string;
  title: string;
  mode: ContentMode;
  status: string;
  fitScore: number | null;
  ageDays: number;
}

export interface ReviewPromptInput {
  productName: string;
  contextText: string;
  neverSay: readonly string[];
  notBuilt: readonly string[];
  lastWeek: readonly ModeValue[];
  ideas: readonly ReviewPromptIdea[];
  today: string;
}

export const REVIEW_SYSTEM = [
  'You review open content ideas for Growth Desk, the marketing desk of the Humini products.',
  'For each idea, give a fresh fitScore (whole number 0 to 100) against the current product context and last week\'s numbers.',
  'Mark an idea stale when it no longer fits: the moment has passed, the product changed, it overlaps a better idea, or it touches a never-say phrase or a feature that is not built.',
  'reason is one plain sentence (at most 20 words). Do not use the long dash character.',
  'Return one review per idea id you were given, and no other ids. You never approve or delete anything.',
].join('\n');

export function buildReviewPrompt(i: ReviewPromptInput): string {
  const lastWeek =
    i.lastWeek.length > 0
      ? i.lastWeek.map((v) => `- ${v.mode}: ${v.pieces} pieces, value per 1k reach ${v.valueScore}`).join('\n')
      : 'No numbers from last week yet.';
  const ideas = i.ideas
    .map((x) => `- id=${x.id} | ${x.mode} | ${x.status} | fit ${x.fitScore ?? 'none'} | ${x.ageDays} days old | ${x.title}`)
    .join('\n');
  return [
    `Today is ${i.today}. Review the open ideas for ${i.productName}.`,
    '',
    '<product_context>',
    i.contextText.trim() || 'No product context yet.',
    '</product_context>',
    '',
    '<never_say>',
    list(i.neverSay, 'Nothing listed.'),
    '</never_say>',
    '',
    '<not_built_yet>',
    list(i.notBuilt, 'Nothing listed.'),
    '</not_built_yet>',
    '',
    '<last_week_value_by_mode>',
    lastWeek,
    '</last_week_value_by_mode>',
    '',
    '<ideas>',
    ideas,
    '</ideas>',
    '',
    'Answer with JSON only.',
  ].join('\n');
}

/** Clean a title from Claude: one line, no long dash, trimmed to the column limit. */
export function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u2014\u2013]/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim()
    .slice(0, max)
    .trim();
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Case and punctuation insensitive key, so "Their clock, not yours" equals "their clock not yours". */
export function titleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
