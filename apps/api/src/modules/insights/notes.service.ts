/**
 * The Monday note: one thing to do more of and one to stop, from last week's numbers.
 * Claude writes the words from numbers we compute. When Claude is not set up, the note is built
 * from the numbers alone and says so in its text (never presented as Claude's work).
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CONTENT_MODE_LONG_LABELS,
  PLATFORM_LABELS,
  type LatestNoteResponse,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { ideas, products, weeklyNotes } from '../../db/schema/index.js';
import { generateJson, isClaudeEnabled } from '../../lib/claude.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toCount } from '../../lib/pagination.js';
import { weekStartKey } from '../../lib/time.js';
import { addDays, isMonday, pickMoreAndStop, type ModeWeekNumbers } from './logic.js';
import { cleanText, toWeeklyNote } from './mappers.js';
import { analyticsByMode } from './analytics.service.js';

type WeeklyNoteRow = typeof weeklyNotes.$inferSelect;

export async function latestNote(productId?: string): Promise<LatestNoteResponse> {
  if (productId) {
    const [own] = await db
      .select()
      .from(weeklyNotes)
      .where(eq(weeklyNotes.productId, productId))
      .orderBy(desc(weeklyNotes.weekStart))
      .limit(1);
    if (own) return { note: toWeeklyNote(own), isEcosystem: false };
  }
  const [eco] = await db
    .select()
    .from(weeklyNotes)
    .where(isNull(weeklyNotes.productId))
    .orderBy(desc(weeklyNotes.weekStart))
    .limit(1);
  return { note: eco ? toWeeklyNote(eco) : null, isEcosystem: Boolean(eco) };
}

const noteSchema = z.object({
  summary: z.string().describe('Two or three short sentences on what happened last week.'),
  doMore: z.string().describe('One thing to do more of, with the number that shows it.'),
  stop: z.string().describe('One thing to stop or cut back, with the number that shows it.'),
});

interface NoteFacts {
  productName: string;
  weekStart: string;
  lastWeek: { from: string; to: string };
  modes: ModeWeekNumbers[];
  bestChannelByMode: Record<string, string | null>;
  fourWeekModes: ModeWeekNumbers[];
  newIdeas: number;
}

async function gatherFacts(
  productId: string,
  productName: string,
  weekStart: string,
): Promise<NoteFacts> {
  const lastWeekEnd = addDays(weekStart, -1);
  // analyticsByMode ends its window on "today": pass a `now` inside the last day of the window.
  const at = (day: string) => new Date(`${day}T12:00:00Z`);
  const [week, month] = await Promise.all([
    analyticsByMode({ productId, days: 7, now: at(lastWeekEnd) }),
    analyticsByMode({ productId, days: 28, now: at(lastWeekEnd) }),
  ]);
  const toNumbers = (m: (typeof week.items)[number]): ModeWeekNumbers => ({
    mode: m.mode,
    label: `${m.mode} ${CONTENT_MODE_LONG_LABELS[m.mode]}`,
    pieces: m.pieces,
    reach: m.reach,
    valuePer1k: m.valuePer1k,
  });
  const [ideaCount] = await db
    .select({ n: sql<string>`count(*)`.mapWith(toCount) })
    .from(ideas)
    .where(
      and(
        eq(ideas.productId, productId),
        eq(ideas.source, 'claude'),
        gte(ideas.createdAt, new Date(`${addDays(weekStart, -7)}T00:00:00Z`)),
      ),
    );
  return {
    productName,
    weekStart,
    lastWeek: { from: week.range.from, to: week.range.to },
    modes: week.items.map(toNumbers),
    bestChannelByMode: Object.fromEntries(
      week.items.map((m) => [m.mode, m.bestChannel ? PLATFORM_LABELS[m.bestChannel] : null]),
    ),
    fourWeekModes: month.items.map(toNumbers),
    newIdeas: ideaCount?.n ?? 0,
  };
}

/** Note text built from the numbers only (used when Claude is not set up). Exported for tests. */
export function ruleBasedNote(f: NoteFacts): { summary: string; doMore: string; stop: string } {
  const { more, stop } = pickMoreAndStop(f.modes);
  if (!more) {
    return {
      summary: `No numbers came in for ${f.productName} in the week of ${f.lastWeek.from}. Written from the numbers (Claude is not set up).`,
      doMore: 'Publish at least one piece this week so there is something to learn from.',
      stop: 'Nothing to stop yet: there are no numbers to compare.',
    };
  }
  const channel = f.bestChannelByMode[more.mode];
  return {
    summary: `${f.productName}, week of ${f.lastWeek.from}: ${more.label} led with ${more.valuePer1k} value per 1K reach over ${more.reach} reach. Written from the numbers (Claude is not set up).`,
    doMore: `More ${more.label}${channel ? ` on ${channel}` : ''} (${more.valuePer1k} value per 1K reach).`,
    stop: stop
      ? `Cut back ${stop.label} (${stop.valuePer1k} value per 1K reach, the lowest last week).`
      : 'Only one mode ran last week: add a second mode next week so there is something to compare.',
  };
}

function prompt(f: NoteFacts): string {
  const line = (m: ModeWeekNumbers) =>
    `- ${m.label}: ${m.pieces} pieces, reach ${m.reach}, value per 1K reach ${m.valuePer1k}${
      f.bestChannelByMode[m.mode] ? `, best channel ${f.bestChannelByMode[m.mode]}` : ''
    }`;
  return [
    `Product: ${f.productName}`,
    `Week of the note (Monday): ${f.weekStart}`,
    `Last week (${f.lastWeek.from} to ${f.lastWeek.to}), by content mode:`,
    f.modes.length ? f.modes.map(line).join('\n') : '- no numbers',
    `Last 4 weeks, by content mode:`,
    f.fourWeekModes.length ? f.fourWeekModes.map(line).join('\n') : '- no numbers',
    `New ideas Claude drafted last week: ${f.newIdeas}`,
    '',
    'Write the Monday note: a short summary, one thing to do more of, one thing to stop.',
  ].join('\n');
}

const SYSTEM = [
  'You write the Monday learning note for a small marketing team.',
  'Use only the numbers given. Never invent numbers, product features or claims.',
  'Value score = (saves*3 + shares*4 + clicks*5 + installs*20 + activations*40) per 1,000 reach.',
  'Plain, simple English. Short sentences. No em-dash characters. No hype.',
].join(' ');

async function writeNoteText(productId: string, f: NoteFacts) {
  if (!isClaudeEnabled()) return ruleBasedNote(f);
  const { data } = await generateJson({
    productId,
    feature: 'insights.monday-note',
    system: SYSTEM,
    prompt: prompt(f),
    schema: noteSchema,
    maxTokens: 2_000,
    effort: 'low',
  });
  return {
    summary: cleanText(data.summary),
    doMore: cleanText(data.doMore),
    stop: cleanText(data.stop),
  };
}

export interface GenerateNoteOptions {
  regenerate?: boolean;
}

/** Writes the note for a product and week, or returns the one already there. */
export async function generateMondayNote(
  productId: string,
  weekStart: string,
  opts: GenerateNoteOptions = {},
): Promise<{ row: WeeklyNoteRow; created: boolean; before: WeeklyNoteRow | null }> {
  if (!isMonday(weekStart)) throw badRequest('weekStart must be a Monday (YYYY-MM-DD).');
  const [product] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw notFound('Product');

  const findExisting = async () =>
    (
      await db
        .select()
        .from(weeklyNotes)
        .where(and(eq(weeklyNotes.productId, productId), eq(weeklyNotes.weekStart, weekStart)))
    )[0] ?? null;

  const existing = await findExisting();
  if (existing && !opts.regenerate) return { row: existing, created: false, before: null };

  const facts = await gatherFacts(productId, product.name, weekStart);
  const text = await writeNoteText(productId, facts);
  const values = {
    productId,
    weekStart,
    body: text.summary,
    doMore: text.doMore,
    stopDoing: text.stop,
  };

  if (existing) {
    const [row] = await db
      .update(weeklyNotes)
      .set({ body: values.body, doMore: values.doMore, stopDoing: values.stopDoing })
      .where(eq(weeklyNotes.id, existing.id))
      .returning();
    return { row: row!, created: false, before: existing };
  }
  const [row] = await db.insert(weeklyNotes).values(values).onConflictDoNothing().returning();
  if (row) return { row, created: true, before: null };
  // Another run wrote it at the same time: return that one.
  const raced = await findExisting();
  if (!raced) throw new Error('Monday note insert lost a race but no row was found');
  return { row: raced, created: false, before: null };
}

export function thisWeekStart(now = new Date()): string {
  return weekStartKey(now, env.appTimezone);
}
