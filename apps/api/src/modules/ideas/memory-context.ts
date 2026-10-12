/**
 * What Claude is told about the content memory before it drafts (BUILD-PLAN section 11):
 * - a coverage map: how often each mode, audience, behaviour and twist was already used,
 *   across ALL products,
 * - the past ideas closest to this run's focus (trigram on promise + requested modes),
 * - a rotating "unexplored angle" seed: under-used audience x behaviour x mode x occasion mixes.
 *
 * Angles are stored as "audience / behaviour / twist" (see `composeAngle`).
 */
import { sql } from 'drizzle-orm';
import { CONTENT_MODE_LABELS, type ContentMode } from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { contentMemory } from '../../db/schema/index.js';
import { normalise } from '../../lib/content-memory.js';

export const ANGLE_SEPARATOR = ' / ';
export const ANGLE_MAX = 160;
/** Past ideas shown to Claude as "closest to this run". */
export const SIMILAR_PAST_LIMIT = 30;
/** Rows per dimension in the coverage map. */
export const COVERAGE_TOP = 25;
/** Unexplored mixes suggested per run. */
export const SEED_COUNT = 5;

/* ---------- Pure ---------- */

function cleanPart(s: string): string {
  return s.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "parents abroad / call at their time / role swap", trimmed to the column limit. */
export function composeAngle(audience: string, behaviour: string, twist: string): string | null {
  const parts = [audience, behaviour, twist].map(cleanPart);
  if (parts.every((p) => !p)) return null;
  return parts.map((p) => p || '-').join(ANGLE_SEPARATOR).slice(0, ANGLE_MAX);
}

export function splitAngle(angle: string | null): { audience: string; behaviour: string; twist: string } | null {
  if (!angle) return null;
  const [audience = '', behaviour = '', ...rest] = angle.split(ANGLE_SEPARATOR);
  return { audience: audience.trim(), behaviour: behaviour.trim(), twist: rest.join(' ').trim() };
}

export interface CountRow {
  key: string;
  n: number;
}

export interface Coverage {
  total: number;
  modes: CountRow[];
  audiences: CountRow[];
  behaviours: CountRow[];
  twists: CountRow[];
}

function countLine(rows: readonly CountRow[], empty: string): string {
  return rows.length > 0 ? rows.map((r) => `${r.key} (${r.n})`).join('; ') : empty;
}

export function formatCoverage(c: Coverage): string {
  if (c.total === 0) return 'Nothing yet. Every angle is open.';
  const modes = c.modes.map((r) => ({ key: `${r.key} ${CONTENT_MODE_LABELS[r.key as ContentMode] ?? ''}`.trim(), n: r.n }));
  return [
    `Ideas remembered across all products: ${c.total}.`,
    `By mode: ${countLine(modes, 'none')}.`,
    `By audience: ${countLine(c.audiences, 'no angle tags yet')}.`,
    `By behaviour: ${countLine(c.behaviours, 'no angle tags yet')}.`,
    `Twists already used: ${countLine(c.twists, 'none yet')}.`,
  ].join('\n');
}

export interface SeedMix {
  audience: string;
  behaviour: string;
  mode: ContentMode;
  occasion: string | null;
  used: number;
}

/**
 * Under-used mixes first. Ties rotate with `rotation` (changes every run), so two runs with the
 * same counts still get different seeds. Pure and deterministic.
 */
export function pickUnexploredSeeds(input: {
  audiences: readonly string[];
  behaviours: readonly string[];
  modes: readonly ContentMode[];
  occasions: readonly string[];
  used: ReadonlyMap<string, number>;
  rotation: number;
  n?: number;
}): SeedMix[] {
  const audiences = input.audiences.length > 0 ? input.audiences : ['the main audience'];
  const behaviours = input.behaviours.length > 0 ? input.behaviours : ['the core behaviour'];
  const occasions: (string | null)[] = [null, ...input.occasions];
  const all: SeedMix[] = [];
  for (const audience of audiences)
    for (const behaviour of behaviours)
      for (const mode of input.modes)
        for (const occasion of occasions)
          all.push({ audience, behaviour, mode, occasion, used: input.used.get(seedKey(audience, behaviour, mode)) ?? 0 });
  if (all.length === 0) return [];
  const shift = ((Math.trunc(input.rotation) % all.length) + all.length) % all.length;
  const rotated = [...all.slice(shift), ...all.slice(0, shift)];
  // Stable sort keeps the rotated order inside each usage level.
  const sorted = rotated.map((m, i) => ({ m, i })).sort((a, b) => a.m.used - b.m.used || a.i - b.i).map((x) => x.m);
  const out: SeedMix[] = [];
  const seenPair = new Set<string>();
  for (const m of sorted) {
    // Spread the seeds: one per audience x behaviour pair while possible.
    const pair = `${m.audience}|${m.behaviour}`;
    if (seenPair.has(pair) && seenPair.size < audiences.length * behaviours.length) continue;
    seenPair.add(pair);
    out.push(m);
    if (out.length >= (input.n ?? SEED_COUNT)) break;
  }
  return out;
}

export function seedKey(audience: string, behaviour: string, mode: string): string {
  return `${audience.trim().toLowerCase()}|${behaviour.trim().toLowerCase()}|${mode}`;
}

export function formatSeeds(seeds: readonly SeedMix[]): string {
  if (seeds.length === 0) return 'No seed this time.';
  return seeds
    .map(
      (s) =>
        `- ${s.audience} x ${s.behaviour} x ${s.mode} ${CONTENT_MODE_LABELS[s.mode]}${s.occasion ? ` x ${s.occasion}` : ''} (used ${s.used} times)`,
    )
    .join('\n');
}

/* ---------- Database ---------- */

async function countBy(expr: ReturnType<typeof sql>): Promise<CountRow[]> {
  const res = await db.execute<{ key: string | null; n: number }>(sql`
    select key, count(*)::int as n
    from (select ${expr} as key from ${contentMemory} where source_type = 'idea') s
    where key is not null and key <> '' and key <> '-'
    group by key
    order by n desc, key limit ${COVERAGE_TOP}`);
  return res.rows.filter((r): r is CountRow => r.key !== null).map((r) => ({ key: r.key, n: Number(r.n) }));
}

/** Counts across ALL products (ideas only; drafts and captions do not count). */
export async function loadCoverage(): Promise<Coverage> {
  const [total, modes, audiences, behaviours, twists] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n from ${contentMemory} where source_type = 'idea'`),
    countBy(sql`mode::text`),
    countBy(sql`btrim(split_part(angle, ${ANGLE_SEPARATOR}, 1))`),
    countBy(sql`btrim(split_part(angle, ${ANGLE_SEPARATOR}, 2))`),
    countBy(sql`btrim(split_part(angle, ${ANGLE_SEPARATOR}, 3))`),
  ]);
  return { total: Number(total.rows[0]?.n ?? 0), modes, audiences, behaviours, twists };
}

/** Usage of each audience x behaviour x mode mix (all products), keyed by `seedKey`. */
export async function loadMixUsage(): Promise<Map<string, number>> {
  const res = await db.execute<{ audience: string; behaviour: string; mode: string; n: number }>(sql`
    select audience, behaviour, mode, count(*)::int as n
    from (
      select lower(btrim(split_part(angle, ${ANGLE_SEPARATOR}, 1))) as audience,
             lower(btrim(split_part(angle, ${ANGLE_SEPARATOR}, 2))) as behaviour,
             coalesce(mode::text, '') as mode
      from ${contentMemory}
      where source_type = 'idea' and angle is not null
    ) s
    group by audience, behaviour, mode`);
  return new Map(res.rows.map((r) => [seedKey(r.audience, r.behaviour, r.mode), Number(r.n)]));
}

export interface PastIdea {
  title: string;
  productName: string | null;
  angle: string | null;
}

/** Past ideas and briefs (all products) closest to this run's focus text. */
export async function loadSimilarPast(focus: string, limit = SIMILAR_PAST_LIMIT): Promise<PastIdea[]> {
  const q = normalise(focus);
  if (!q) return [];
  const res = await db.execute<{ title: string; product_name: string | null; angle: string | null }>(sql`
    select m.title, p.name as product_name, m.angle
    from ${contentMemory} m left join products p on p.id = m.product_id
    where m.source_type in ('idea', 'brief_hook')
    order by word_similarity(m.normalized, ${q}) desc, m.created_at desc
    limit ${limit}`);
  return res.rows.map((r) => ({ title: r.title, productName: r.product_name, angle: r.angle }));
}

export function formatPast(past: readonly PastIdea[]): string {
  if (past.length === 0) return 'None yet.';
  return past.map((p) => `- ${p.title}${p.productName ? ` (${p.productName})` : ''}${p.angle ? ` [${p.angle}]` : ''}`).join('\n');
}
