/**
 * Content memory (BUILD-PLAN section 11, ADR 0009): no idea, hook or caption is used twice,
 * for any product, ever. Three check layers:
 *
 * | Layer       | Catches                         | How                                       |
 * |-------------|---------------------------------|-------------------------------------------|
 * | fingerprint | exact and near-exact repeats    | sorted unique key words, SHA-256, unique  |
 * | text        | reworded titles and hooks       | pg_trgm similarity on the normalised text |
 * | meaning     | the same idea in other words    | pgvector cosine on Voyage embeddings      |
 *
 * Thresholds live in `MEMORY_THRESHOLDS` (one place to tune, see docs/runbooks/content-memory.md).
 * Pure parts (`normalise`, `fingerprint`, `trigramSimilarity`, `memoryKeys`) are unit tested;
 * `checkDuplicate`, `remember` and `withMemoryLock` need Postgres with pg_trgm and pgvector.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { MemoryLayer, MemoryMatch, MemorySourceType, MemoryStatus, ContentMode } from '@growth-desk/contract';
import type { DbOrTx } from '../db/client.js';
import { contentMemory } from '../db/schema/index.js';
import { embeddingsModel } from './embeddings.js';

/* ---------- Config (the one place to tune) ---------- */

export const MEMORY_THRESHOLDS = {
  /** pg_trgm similarity at or above this is a duplicate. */
  textDuplicate: 0.55,
  /** pg_trgm similarity at or above this is "similar" (needs a reason). Keep it >= 0.3. */
  textSimilar: 0.4,
  /** Cosine similarity of embeddings at or above this is a duplicate. */
  meaningDuplicate: 0.9,
  /** Cosine similarity at or above this is "similar". */
  meaningSimilar: 0.83,
} as const;

/** Most matches returned by one check. */
export const MEMORY_MAX_MATCHES = 5;

/** Fixed key for `pg_advisory_xact_lock`: every write that must stay unique takes it. */
export const MEMORY_LOCK_KEY = 2_026_101_209;

/* ---------- Pure text helpers ---------- */

/** Small English stop word list: words that never make two ideas different. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'so', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'into', 'about', 'than', 'then', 'very', 'just',
]);

const UNITS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000 };

const isNumberWord = (t: string) => t in UNITS || t in TENS || t in SCALES;

/** "twenty five" -> "25", "sixty" -> "60", "two hundred" -> "200". Other words pass through. */
export function foldNumberWords(tokens: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isNumberWord(tokens[i]!)) {
      out.push(tokens[i]!);
      i += 1;
      continue;
    }
    let total = 0;
    let current = 0;
    let last: 'unit' | 'teen' | 'tens' | 'scale' | null = null;
    while (i < tokens.length && isNumberWord(tokens[i]!)) {
      const w = tokens[i]!;
      if (w in UNITS) {
        const n = UNITS[w]!;
        const teen = n >= 10;
        // "twenty five" joins; "one two" and "twenty eleven" are separate numbers.
        const ok = last === null || last === 'scale' || (last === 'tens' && !teen);
        if (!ok) break;
        current += n;
        last = teen ? 'teen' : 'unit';
      } else if (w in TENS) {
        if (!(last === null || last === 'scale')) break;
        current += TENS[w]!;
        last = 'tens';
      } else {
        if (last === 'scale' && w === 'hundred') break;
        const scale = SCALES[w]!;
        current = (current === 0 ? 1 : current) * scale;
        if (scale >= 1000) {
          total += current;
          current = 0;
        }
        last = 'scale';
      }
      i += 1;
    }
    out.push(String(total + current));
  }
  return out;
}

/**
 * Normalise text for comparison: lower case, accents folded, apostrophes joined
 * ("you're" -> "youre"), punctuation and emoji removed, number words to digits, stop words
 * dropped, spaces collapsed. Word order is kept.
 */
export function normalise(text: string): string {
  const folded = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['‘’`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!folded) return '';
  const tokens = foldNumberWords(folded.split(/\s+/));
  return tokens.filter((t) => !STOP_WORDS.has(t)).join(' ');
}

/** SHA-256 of the sorted unique key words of title + hook. Word order and repeats do not matter. */
export function fingerprint(title: string, hook?: string | null): string {
  const text = hook ? `${title} ${hook}` : title;
  const words = [...new Set(normalise(text).split(' ').filter(Boolean))].sort();
  const key = words.length > 0 ? words.join(' ') : text.trim().toLowerCase();
  return createHash('sha256').update(key).digest('hex');
}

/** Trigrams of a normalised string, the way pg_trgm builds them ("  w", " wo", "wor", "ord", "rd "). */
export function trigrams(normalized: string): Set<string> {
  const set = new Set<string>();
  for (const word of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) set.add(padded.slice(i, i + 3));
  }
  return set;
}

/** Same number as pg_trgm `similarity()` on two normalised strings (shared / union of trigrams). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Similarity level for a text score, or null when below the "similar" threshold. */
export function textLevel(score: number, t = MEMORY_THRESHOLDS): 'duplicate' | 'similar' | null {
  if (score >= t.textDuplicate) return 'duplicate';
  if (score >= t.textSimilar) return 'similar';
  return null;
}

export function meaningLevel(score: number, t = MEMORY_THRESHOLDS): 'duplicate' | 'similar' | null {
  if (score >= t.meaningDuplicate) return 'duplicate';
  if (score >= t.meaningSimilar) return 'similar';
  return null;
}

/** What a check compares as: an idea title, a brief (title + hook) or a caption. */
export type MemoryKind = 'idea' | 'brief_hook' | 'post_caption';

/** Which stored rows a check of `kind` compares with. Dropped drafts never block anything. */
export const KIND_SOURCES: Readonly<Record<MemoryKind, readonly MemorySourceType[]>> = {
  idea: ['idea', 'brief_hook'],
  brief_hook: ['idea', 'brief_hook'],
  post_caption: ['post_caption'],
};

function kindOf(sourceType: MemorySourceType): MemoryKind {
  return sourceType === 'dropped_draft' ? 'idea' : sourceType;
}

/** The normalised text and fingerprint stored for (and compared as) a piece of content. */
export function memoryKeys(kind: MemoryKind, title: string, body?: string | null): { normalized: string; fingerprint: string } {
  if (kind === 'brief_hook') {
    const hook = body?.trim() ? body : null;
    return { normalized: normalise(hook ? `${title} ${hook}` : title), fingerprint: fingerprint(title, hook) };
  }
  if (kind === 'post_caption') {
    const text = body?.trim() ? body : title;
    return { normalized: normalise(text), fingerprint: fingerprint(text) };
  }
  return { normalized: normalise(title), fingerprint: fingerprint(title) };
}

/** Text sent to the embeddings model for a piece of content. */
export function embeddingText(kind: MemoryKind, title: string, body?: string | null): string {
  if (kind === 'post_caption') return (body?.trim() ? body : title).slice(0, 4_000);
  return body?.trim() ? `${title}. ${body}`.slice(0, 4_000) : title;
}

/** Merges per-layer hits into one list: duplicate before similar, then higher score. */
export function mergeMatches(hits: readonly MemoryMatch[], max = MEMORY_MAX_MATCHES): { status: MemoryStatus; matches: MemoryMatch[] } {
  const best = new Map<string, MemoryMatch>();
  const rank = (m: MemoryMatch) => (m.level === 'duplicate' ? 2 : 1) + m.score / 10;
  for (const h of hits) {
    const prev = best.get(h.id);
    if (!prev || rank(h) > rank(prev)) best.set(h.id, h);
  }
  const matches = [...best.values()].sort((a, b) => rank(b) - rank(a)).slice(0, max);
  const status: MemoryStatus = matches.some((m) => m.level === 'duplicate')
    ? 'duplicate'
    : matches.length > 0
      ? 'similar'
      : 'unique';
  return { status, matches };
}

/* ---------- Database ---------- */

export interface CheckDuplicateInput {
  title: string;
  /** Hook (brief), caption (post) or "why" (idea, used only for the meaning layer). */
  body?: string | null | undefined;
  /** The product asking. Checks are global; this only travels into logs and audit. */
  productId?: string | null | undefined;
  kind?: MemoryKind | undefined;
  /** Source ids (idea, brief or post ids) whose rows are skipped, for example the row being edited. */
  excludeSourceIds?: readonly string[] | undefined;
  /** Pre-computed embedding of `embeddingText(kind, title, body)`; null or missing skips layer 3. */
  embedding?: readonly number[] | null | undefined;
}

export interface CheckDuplicateResult {
  status: MemoryStatus;
  matches: MemoryMatch[];
}

interface MatchRow extends Record<string, unknown> {
  id: string;
  source_type: MemorySourceType;
  source_id: string | null;
  product_id: string | null;
  product_name: string | null;
  title: string;
  body: string | null;
  created_at: Date | string;
  score: number | string;
}

function toMatch(r: MatchRow, layer: MemoryLayer, level: 'duplicate' | 'similar'): MemoryMatch {
  const score = Math.max(0, Math.min(1, Number(r.score)));
  return {
    id: r.id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    productId: r.product_id,
    productName: r.product_name,
    title: r.title,
    body: r.body,
    score: Math.round(score * 1000) / 1000,
    layer,
    level,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function vectorLiteral(v: readonly number[]): string {
  return `[${v.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}

/**
 * Checks a title (and hook or caption) against every product's memory.
 * Runs in its own savepoint, so it can set the pg_trgm threshold locally.
 */
export async function checkDuplicate(input: CheckDuplicateInput, tx: DbOrTx): Promise<CheckDuplicateResult> {
  const kind = input.kind ?? 'idea';
  const { normalized, fingerprint: fp } = memoryKeys(kind, input.title, input.body);
  const types = KIND_SOURCES[kind];
  const typeList = sql.join(
    types.map((t) => sql`${t}`),
    sql`, `,
  );
  const exclude = [...new Set(input.excludeSourceIds ?? [])];
  const notExcluded =
    exclude.length > 0
      ? sql`and (m.source_id is null or m.source_id not in (${sql.join(
          exclude.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}))`
      : sql``;
  const t = MEMORY_THRESHOLDS;

  return tx.transaction(async (s) => {
    const hits: MemoryMatch[] = [];
    const select = sql`select m.id, m.source_type, m.source_id, m.product_id, p.name as product_name,
        m.title, m.body, m.created_at`;
    const from = sql`from ${contentMemory} m left join products p on p.id = m.product_id`;

    const exact = await s.execute<MatchRow>(sql`${select}, 1::float8 as score ${from}
      where m.fingerprint = ${fp} and m.source_type in (${typeList}) ${notExcluded}
      order by m.created_at limit ${MEMORY_MAX_MATCHES}`);
    for (const r of exact.rows) hits.push(toMatch(r, 'fingerprint', 'duplicate'));

    if (normalized) {
      await s.execute(sql`select set_config('pg_trgm.similarity_threshold', ${String(t.textSimilar)}, true)`);
      const text = await s.execute<MatchRow>(sql`${select}, similarity(m.normalized, ${normalized})::float8 as score ${from}
        where m.normalized % ${normalized} and m.source_type in (${typeList}) ${notExcluded}
        order by score desc limit 20`);
      for (const r of text.rows) {
        const level = textLevel(Number(r.score));
        if (level) hits.push(toMatch(r, 'text', level));
      }
    }

    if (input.embedding && input.embedding.length > 0) {
      const vec = vectorLiteral(input.embedding);
      const meaning = await s.execute<MatchRow>(sql`${select}, (1 - (m.embedding <=> ${vec}::vector))::float8 as score ${from}
        where m.embedding is not null and m.source_type in (${typeList}) ${notExcluded}
        order by m.embedding <=> ${vec}::vector limit 10`);
      for (const r of meaning.rows) {
        const level = meaningLevel(Number(r.score));
        if (level) hits.push(toMatch(r, 'meaning', level));
      }
    }
    return mergeMatches(hits);
  });
}

/** Serialises every memory write that must stay unique (held until the transaction ends). */
export async function withMemoryLock<T>(tx: DbOrTx, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`select pg_advisory_xact_lock(${MEMORY_LOCK_KEY})`);
  return fn();
}

export interface RememberInput {
  sourceType: MemorySourceType;
  /** Idea, brief or post id; null for a dropped draft. */
  sourceId: string | null;
  productId: string | null;
  title: string;
  body?: string | null | undefined;
  angle?: string | null | undefined;
  mode?: ContentMode | null | undefined;
  /** Embedding of `embeddingText(...)`; null when the feature is off or the call failed. */
  embedding?: readonly number[] | null | undefined;
  createdAt?: Date | undefined;
}

export type RememberOutcome = 'stored' | 'updated' | 'skipped';

/**
 * Stores (or, for the same idea, brief or post, updates) one memory row. Never deletes.
 * An idea or hook whose fingerprint another row already holds is skipped, not stored twice:
 * call `checkDuplicate` first, under `withMemoryLock`, to block that case with a clear error.
 */
export async function remember(input: RememberInput, tx: DbOrTx): Promise<RememberOutcome> {
  const kind = kindOf(input.sourceType);
  const { normalized, fingerprint: fp } = memoryKeys(kind, input.title, input.body);
  const unique = input.sourceType === 'idea' || input.sourceType === 'brief_hook';
  const embedding = input.embedding && input.embedding.length > 0 ? vectorLiteral(input.embedding) : null;
  const model = embedding ? embeddingsModel() : null;

  if (unique) {
    const taken = await tx.execute<{ id: string }>(sql`select id from ${contentMemory}
      where fingerprint = ${fp} and source_type in ('idea', 'brief_hook')
        and not (source_type = ${input.sourceType} and source_id is not distinct from ${input.sourceId}::uuid)
      limit 1`);
    if (taken.rows.length > 0) return 'skipped';
  }

  const values = sql`${input.productId}::uuid, ${input.sourceType}::memory_source_type, ${input.sourceId}::uuid,
    ${input.title}, ${input.body ?? null}, ${normalized}, ${fp}, ${input.angle ?? null},
    ${input.mode ?? null}::content_mode, ${embedding}::vector, ${model}, ${input.createdAt ?? new Date()}`;
  const cols = sql`(product_id, source_type, source_id, title, body, normalized, fingerprint, angle, mode, embedding, embedding_model, created_at)`;

  if (input.sourceId === null) {
    await tx.execute(sql`insert into ${contentMemory} ${cols} values (${values})`);
    return 'stored';
  }
  const res = await tx.execute<{ inserted: boolean }>(sql`insert into ${contentMemory} ${cols} values (${values})
    on conflict (source_type, source_id) where source_id is not null do update set
      title = excluded.title,
      body = excluded.body,
      normalized = excluded.normalized,
      fingerprint = excluded.fingerprint,
      angle = coalesce(excluded.angle, ${contentMemory}.angle),
      mode = coalesce(excluded.mode, ${contentMemory}.mode),
      embedding = case when excluded.embedding is not null then excluded.embedding
                       when ${contentMemory}.normalized = excluded.normalized then ${contentMemory}.embedding
                       else null end,
      embedding_model = case when excluded.embedding is not null then excluded.embedding_model
                       when ${contentMemory}.normalized = excluded.normalized then ${contentMemory}.embedding_model
                       else null end,
      updated_at = now()
    returning (xmax = 0) as inserted`);
  return res.rows[0]?.inserted ? 'stored' : 'updated';
}
