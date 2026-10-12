/**
 * Generate ideas with Claude and the weekly review of open ideas.
 * Used by POST /ideas/generate and by SETTINGS' weekly run (through shared.ts).
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  CONTENT_MODES,
  CONTENT_MODE_LABELS,
  IDEA_TITLE_MAX,
  IDEA_SUMMARY_MAX,
  computeValueScore,
  type ContentMode,
  type Idea,
  type Platform,
} from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { briefs, ideas, metricSnapshots, posts, productKits, products } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { lintText, notBuiltName, type LintKit } from '../../lib/claim-lint.js';
import { generateJson, isClaudeEnabled } from '../../lib/claude.js';
import {
  MEMORY_THRESHOLDS,
  checkDuplicate,
  embeddingText,
  memoryKeys,
  remember,
  trigramSimilarity,
  withMemoryLock,
} from '../../lib/content-memory.js';
import { cosineSimilarity, embedTexts } from '../../lib/embeddings.js';
import { featureDisabled, notFound } from '../../lib/errors.js';
import { DAY_MS, dateKey, weekStartKey } from '../../lib/time.js';
import { buildProductContext } from '../settings/shared.js';
import {
  IDEAS_SYSTEM,
  REVIEW_SYSTEM,
  buildGeneratePrompt,
  buildReviewPrompt,
  claudeIdeasSchema,
  claudeReviewSchema,
  clampScore,
  cleanText,
  titleKey,
  type ModeValue,
} from './prompts.js';
import {
  composeAngle,
  formatCoverage,
  formatPast,
  formatSeeds,
  loadCoverage,
  loadMixUsage,
  loadSimilarPast,
  pickUnexploredSeeds,
} from './memory-context.js';
import { listOccasions, toIdeaDtos, usedTitles } from './repo.js';

/** Token budget for the product context inside one prompt. */
export const CONTEXT_MAX_TOKENS = 6_000;
/** A `new` idea still not starred or parked this long after it was made is flagged stale. */
export const STALE_AFTER_DAYS = 28;
/** Most ideas one review call looks at (highest fit first). */
export const REVIEW_MAX_IDEAS = 60;
export const STALE_PREFIX = 'Stale: ';

interface KitForLint extends LintKit {
  neverSay: string[];
  notBuilt: { text: string }[];
}

async function loadProduct(productId: string): Promise<{ id: string; name: string }> {
  const [row] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!row) throw notFound('Product');
  return row;
}

/** Latest kit version (signed or not). Empty lists when the product has no kit yet. */
export async function loadLintKit(productId: string): Promise<KitForLint> {
  const [kit] = await db
    .select({ neverSay: productKits.neverSay, notBuilt: productKits.notBuilt })
    .from(productKits)
    .where(eq(productKits.productId, productId))
    .orderBy(desc(productKits.version))
    .limit(1);
  return { neverSay: kit?.neverSay ?? [], notBuilt: kit?.notBuilt ?? [] };
}

/** Value by content mode for the full week (Mon to Sun) before the one holding `now`. */
export async function lastWeekValueByMode(productId: string, now = new Date()): Promise<ModeValue[]> {
  const thisMonday = Date.parse(`${weekStartKey(now)}T00:00:00Z`);
  const from = new Date(thisMonday - 7 * DAY_MS).toISOString().slice(0, 10);
  const to = new Date(thisMonday - DAY_MS).toISOString().slice(0, 10);
  const rows = await db
    .select({
      mode: briefs.mode,
      pieces: sql<number>`count(distinct ${briefs.id})::int`,
      reach: sql<number>`coalesce(sum(${metricSnapshots.reach}), 0)::int`,
      saves: sql<number>`coalesce(sum(${metricSnapshots.saves}), 0)::int`,
      shares: sql<number>`coalesce(sum(${metricSnapshots.shares}), 0)::int`,
      clicks: sql<number>`coalesce(sum(${metricSnapshots.clicks}), 0)::int`,
      installs: sql<number>`coalesce(sum(${metricSnapshots.installs}), 0)::int`,
      activations: sql<number>`coalesce(sum(${metricSnapshots.activations}), 0)::int`,
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(metricSnapshots.postId, posts.id))
    .innerJoin(briefs, eq(posts.briefId, briefs.id))
    .where(and(eq(briefs.productId, productId), gte(metricSnapshots.date, from), lte(metricSnapshots.date, to)))
    .groupBy(briefs.mode);
  return rows
    .map((r) => ({ mode: r.mode, pieces: r.pieces, reach: r.reach, valueScore: computeValueScore(r) }))
    .sort((a, b) => b.valueScore - a.valueScore);
}

export interface GenerateInput {
  count: number;
  modes?: ContentMode[] | undefined;
  channels?: Platform[] | undefined;
  source: 'manual' | 'weekly';
  weeklyRunId?: string | undefined;
}

export interface GenerateResult {
  ideas: Idea[];
  /** Every draft not kept (lint, wrong mode, repeat, or more than asked). */
  dropped: number;
  /** Drafts dropped because they repeat earlier content (stored as `dropped_draft`). */
  droppedAsDuplicate: number;
  /** Claude calls made: 1, plus up to `GENERATE_EXTRA_ROUNDS`. */
  rounds: number;
}

/** Claude is asked for this many times the missing number, so repeats can be dropped. */
export const GENERATE_OVERASK = 1.5;
/** Extra rounds that ask only for the missing number. */
export const GENERATE_EXTRA_ROUNDS = 2;
/** Most drafts asked for in one call. */
export const GENERATE_ASK_MAX = 45;

export function lintIdeaText(text: string, kit: LintKit): string | null {
  const hits = lintText(text, kit);
  return hits.length > 0 ? hits[0]!.match : null;
}

/** How many drafts to ask for when `missing` ideas are still needed. */
export function askFor(missing: number): number {
  return Math.min(GENERATE_ASK_MAX, Math.max(missing, Math.ceil(missing * GENERATE_OVERASK)));
}

interface Candidate {
  title: string;
  why: string;
  mode: ContentMode;
  channels: Platform[];
  fitScore: number;
  angle: string | null;
  normalized: string;
  fingerprint: string;
  embedding: number[] | null;
}

interface DroppedRepeat {
  candidate: Candidate;
  reason: string;
}

/**
 * Same-batch repeat check (pure): fingerprint, trigram and (when both have one) cosine,
 * with the same thresholds as the database check.
 */
export function repeatsInBatch(
  c: Pick<Candidate, 'normalized' | 'fingerprint' | 'embedding'>,
  kept: readonly Pick<Candidate, 'normalized' | 'fingerprint' | 'embedding' | 'title'>[],
): string | null {
  for (const k of kept) {
    if (k.fingerprint === c.fingerprint) return k.title;
    if (c.normalized && k.normalized && trigramSimilarity(c.normalized, k.normalized) >= MEMORY_THRESHOLDS.textSimilar) return k.title;
    if (c.embedding && k.embedding && cosineSimilarity(c.embedding, k.embedding) >= MEMORY_THRESHOLDS.meaningSimilar) return k.title;
  }
  return null;
}

interface KitForIdeas {
  promise: string | null;
  audiences: string[];
  behaviours: string[];
}

async function loadKitForIdeas(productId: string): Promise<KitForIdeas> {
  const [kit] = await db
    .select({ promise: productKits.promise, audiences: productKits.audiences, behaviours: productKits.behaviours })
    .from(productKits)
    .where(eq(productKits.productId, productId))
    .orderBy(desc(productKits.version))
    .limit(1);
  return {
    promise: kit?.promise ?? null,
    audiences: (kit?.audiences ?? []).map((a) => a.trim()).filter(Boolean),
    behaviours: (kit?.behaviours ?? []).map((b) => b.text.trim()).filter(Boolean),
  };
}

/**
 * Asks Claude for ideas and keeps only new ones (BUILD-PLAN section 11):
 * 1. the prompt carries the coverage map, the 30 closest past ideas and an unexplored seed,
 * 2. Claude is asked for 50% more than needed; drafts that fail the never-say lint, use a mode
 *    that was not asked for, or repeat the memory (or each other) are dropped,
 * 3. up to 2 extra rounds ask only for the missing number, listing what was rejected,
 * 4. the kept ideas are re-checked and stored under the memory lock in one transaction,
 *    each one remembered; repeats are remembered as `dropped_draft`.
 */
export async function generateIdeasDetailed(
  productId: string,
  input: GenerateInput,
  actorId: string | null,
): Promise<GenerateResult> {
  if (!isClaudeEnabled()) {
    throw featureDisabled('Claude', 'Claude is not connected. Add ANTHROPIC_API_KEY on the Integrations page.');
  }
  const product = await loadProduct(productId);
  const count = Math.max(1, Math.min(30, Math.round(input.count)));
  const modes = [...new Set(input.modes ?? [])].filter((m) => CONTENT_MODES.includes(m));
  const channels = [...new Set(input.channels ?? [])];
  const now = new Date();
  const today = dateKey(now);
  const sixWeeks = dateKey(new Date(now.getTime() + 42 * DAY_MS));

  const [kit, kitIdeas, context, lastWeek, occasions, used, coverage, mixUsage] = await Promise.all([
    loadLintKit(productId),
    loadKitForIdeas(productId),
    buildProductContext(productId, { maxTokens: CONTEXT_MAX_TOKENS }),
    lastWeekValueByMode(productId, now),
    listOccasions(today, sixWeeks, productId),
    usedTitles(productId),
    loadCoverage(),
    loadMixUsage(),
  ]);
  const focusModes = modes.length > 0 ? modes : [...CONTENT_MODES];
  const focus = [kitIdeas.promise ?? product.name, ...focusModes.map((m) => CONTENT_MODE_LABELS[m])].join(' ');
  const similarPast = await loadSimilarPast(focus);
  const seeds = pickUnexploredSeeds({
    audiences: kitIdeas.audiences,
    behaviours: kitIdeas.behaviours,
    modes: focusModes,
    occasions: occasions.map((o) => o.name),
    used: mixUsage,
    rotation: Math.floor(now.getTime() / DAY_MS) + coverage.total,
  });

  const kept: Candidate[] = [];
  const repeats: DroppedRepeat[] = [];
  const rejected: { title: string; reason: string }[] = [];
  let droppedOther = 0;
  let rounds = 0;
  // Extra guard for rows the memory may not hold yet (made before the backfill ran).
  const usedKeys = new Set(used.map(titleKey));

  while (kept.length < count && rounds < 1 + GENERATE_EXTRA_ROUNDS) {
    rounds += 1;
    const missing = count - kept.length;
    const ask = askFor(missing);
    const { data } = await generateJson({
      productId,
      feature: input.source === 'weekly' ? 'ideas.weekly' : 'ideas.generate',
      system: IDEAS_SYSTEM,
      prompt: buildGeneratePrompt({
        productName: product.name,
        contextText: context.text,
        neverSay: kit.neverSay,
        notBuilt: kit.notBuilt.map((n) => notBuiltName(n.text)),
        lastWeek,
        occasions: occasions.map((o) => ({ name: o.name, date: o.date, endDate: o.endDate })),
        usedTitles: used,
        audiences: kitIdeas.audiences,
        behaviours: kitIdeas.behaviours,
        coverageText: formatCoverage(coverage),
        similarPastText: formatPast(similarPast),
        seedsText: formatSeeds(seeds),
        rejected: rejected.slice(-40),
        count: ask,
        modes,
        channels,
        today,
      }),
      schema: claudeIdeasSchema,
      maxTokens: 8_000,
    });

    // Clean and lint first; only drafts that could be kept are embedded and checked.
    const drafts: Candidate[] = [];
    for (const raw of data.ideas) {
      const title = cleanText(raw.title, IDEA_TITLE_MAX);
      const why = cleanText(raw.why, IDEA_SUMMARY_MAX);
      const badMode = modes.length > 0 && !modes.includes(raw.mode);
      const flagged = title ? lintIdeaText(`${title}\n${why}`, kit) : null;
      if (!title || badMode || flagged !== null) {
        droppedOther += 1;
        if (title) rejected.push({ title, reason: flagged ? `uses "${flagged}", which the kit does not allow` : 'wrong mode' });
        continue;
      }
      const ideaChannels = channels.length > 0 ? raw.channels.filter((c) => channels.includes(c)) : raw.channels;
      const keys = memoryKeys('idea', title);
      drafts.push({
        title,
        why,
        mode: raw.mode,
        channels: [...new Set(ideaChannels.length > 0 ? ideaChannels : channels)],
        fitScore: clampScore(raw.fitScore),
        angle: composeAngle(cleanText(raw.audience, 60), cleanText(raw.behaviour, 80), cleanText(raw.angle, 60)),
        normalized: keys.normalized,
        fingerprint: keys.fingerprint,
        embedding: null,
      });
    }
    const vectors = await embedTexts(drafts.map((d) => embeddingText('idea', d.title, d.why)));
    drafts.forEach((d, i) => (d.embedding = vectors[i] ?? null));

    // Best fit first, so when there are more new drafts than needed the best ones stay.
    drafts.sort((a, b) => b.fitScore - a.fitScore);
    for (const d of drafts) {
      const sameBatch =
        (usedKeys.has(titleKey(d.title)) ? d.title : null) ??
        repeatsInBatch(d, kept) ??
        repeatsInBatch(d, repeats.map((r) => r.candidate));
      if (sameBatch) {
        repeats.push({ candidate: d, reason: `repeats "${sameBatch}" from this run` });
        rejected.push({ title: d.title, reason: `too close to "${sameBatch}"` });
        continue;
      }
      const check = await checkDuplicate({ kind: 'idea', title: d.title, body: d.why, productId, embedding: d.embedding }, db);
      if (check.status !== 'unique') {
        const top = check.matches[0]!;
        repeats.push({ candidate: d, reason: `${check.status} to "${top.title}" (${top.layer} ${top.score})` });
        rejected.push({ title: d.title, reason: `too close to "${top.title}", made before` });
        continue;
      }
      if (kept.length >= count) {
        droppedOther += 1;
        continue;
      }
      kept.push(d);
    }
  }

  const { rows, lateRepeats } = await db.transaction((tx) =>
    withMemoryLock(tx, async () => {
      const inserted: IdeaRowType[] = [];
      const late: DroppedRepeat[] = [];
      for (const c of kept) {
        // Re-check under the lock: another run may have stored the same idea meanwhile.
        const check = await checkDuplicate({ kind: 'idea', title: c.title, body: c.why, productId, embedding: c.embedding }, tx);
        if (check.status !== 'unique') {
          late.push({ candidate: c, reason: `${check.status} to "${check.matches[0]!.title}" (stored meanwhile)` });
          continue;
        }
        const [row] = await tx
          .insert(ideas)
          .values({
            productId,
            title: c.title,
            summary: c.why || null,
            mode: c.mode,
            channels: c.channels,
            fitScore: c.fitScore,
            angle: c.angle,
            status: 'new',
            source: 'claude',
            createdById: actorId,
          })
          .returning();
        await remember(
          { sourceType: 'idea', sourceId: row!.id, productId, title: row!.title, body: row!.summary, angle: row!.angle, mode: row!.mode, embedding: c.embedding },
          tx,
        );
        inserted.push(row!);
      }
      for (const r of [...repeats, ...late]) {
        await remember(
          {
            sourceType: 'dropped_draft',
            sourceId: null,
            productId,
            title: r.candidate.title,
            body: r.candidate.why,
            angle: r.candidate.angle,
            mode: r.candidate.mode,
            embedding: r.candidate.embedding,
          },
          tx,
        );
      }
      const droppedAsDuplicate = repeats.length + late.length;
      await writeAudit(
        {
          actorId,
          action: 'idea.generate',
          entity: 'product',
          entityId: productId,
          after: {
            source: input.source,
            weeklyRunId: input.weeklyRunId ?? null,
            asked: count,
            created: inserted.length,
            dropped: droppedOther + droppedAsDuplicate,
            droppedAsDuplicate,
            rounds,
            repeats: [...repeats, ...late].map((r) => ({ title: r.candidate.title, reason: r.reason })),
            ideaIds: inserted.map((r) => r.id),
          },
        },
        tx,
      );
      return { rows: inserted, lateRepeats: late.length };
    }),
  );

  const droppedAsDuplicate = repeats.length + lateRepeats;
  return { ideas: await toIdeaDtos(rows), dropped: droppedOther + droppedAsDuplicate, droppedAsDuplicate, rounds };
}

type IdeaRowType = typeof ideas.$inferSelect;

export interface ReviewResult {
  rescored: number;
  flaggedStale: number;
}

/**
 * Weekly review of open ideas (new and starred):
 * - Claude re-scores fit and flags stale ideas (skipped when Claude is not connected),
 * - an idea that now hits the never-say lint, or a `new` idea untouched for 4 weeks, is stale.
 * A stale idea gets the note "Stale: <reason>". Notes written by people are never overwritten.
 */
export async function reviewOpenIdeas(productId: string): Promise<ReviewResult> {
  const product = await loadProduct(productId);
  const open = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.productId, productId), inArray(ideas.status, ['new', 'starred']), isNull(ideas.deletedAt)))
    .orderBy(sql`${ideas.fitScore} desc nulls last`, desc(ideas.createdAt))
    .limit(REVIEW_MAX_IDEAS);
  if (open.length === 0) return { rescored: 0, flaggedStale: 0 };

  const kit = await loadLintKit(productId);
  const now = new Date();
  const ageDays = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);

  const claude = new Map<string, { fitScore: number; stale: boolean; reason: string }>();
  if (isClaudeEnabled()) {
    const [context, lastWeek] = await Promise.all([
      buildProductContext(productId, { maxTokens: CONTEXT_MAX_TOKENS }),
      lastWeekValueByMode(productId, now),
    ]);
    const { data } = await generateJson({
      productId,
      feature: 'ideas.review',
      system: REVIEW_SYSTEM,
      prompt: buildReviewPrompt({
        productName: product.name,
        contextText: context.text,
        neverSay: kit.neverSay,
        notBuilt: kit.notBuilt.map((n) => notBuiltName(n.text)),
        lastWeek,
        ideas: open.map((i) => ({
          id: i.id,
          title: i.title,
          mode: i.mode,
          status: i.status,
          fitScore: i.fitScore,
          ageDays: ageDays(i.createdAt),
        })),
        today: dateKey(now),
      }),
      schema: claudeReviewSchema,
      maxTokens: 6_000,
    });
    const ids = new Set(open.map((i) => i.id));
    for (const r of data.reviews) {
      if (ids.has(r.id)) claude.set(r.id, { fitScore: clampScore(r.fitScore), stale: r.stale, reason: cleanText(r.reason, 140) });
    }
  }

  let rescored = 0;
  let flaggedStale = 0;
  const changes: { id: string; fitScore: number | null; note: string | null; before: { fitScore: number | null; note: string | null } }[] = [];
  for (const idea of open) {
    const review = claude.get(idea.id);
    const fitScore = review ? review.fitScore : idea.fitScore;
    const lintHit = lintIdeaText(`${idea.title}\n${idea.summary ?? ''}`, kit);
    let staleReason: string | null = null;
    if (lintHit) staleReason = `uses "${lintHit}", which the kit does not allow`;
    else if (review?.stale) staleReason = review.reason || 'no longer fits';
    else if (idea.status === 'new' && ageDays(idea.createdAt) >= STALE_AFTER_DAYS) staleReason = `still new after ${STALE_AFTER_DAYS} days`;

    const ownNote = idea.note !== null && !idea.note.startsWith(STALE_PREFIX);
    let note = idea.note;
    if (!ownNote) note = staleReason ? `${STALE_PREFIX}${staleReason}`.slice(0, 200) : null;
    if (staleReason) flaggedStale += 1;
    if (fitScore !== idea.fitScore) rescored += 1;
    if (fitScore !== idea.fitScore || note !== idea.note) {
      changes.push({ id: idea.id, fitScore, note, before: { fitScore: idea.fitScore, note: idea.note } });
    }
  }

  await db.transaction(async (tx) => {
    for (const c of changes) {
      await tx.update(ideas).set({ fitScore: c.fitScore, note: c.note }).where(eq(ideas.id, c.id));
    }
    await writeAudit(
      {
        actorId: null,
        action: 'idea.review',
        entity: 'product',
        entityId: productId,
        after: { reviewed: open.length, rescored, flaggedStale, usedClaude: claude.size > 0, changes },
      },
      tx,
    );
  });
  return { rescored, flaggedStale };
}
