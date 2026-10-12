/**
 * Voyage AI embeddings for the content memory "meaning" check (ADR 0009).
 *
 * - Key VOYAGE_API_KEY, model VOYAGE_MODEL (default voyage-4, 1024 numbers per text).
 * - No key: `isEmbeddingsEnabled()` is false and `embedTexts` returns null for every text.
 *   The fingerprint and trigram checks still run.
 * - The answer is validated with zod. A slow or failed call never blocks a save: the caller
 *   gets null and the row is stored without an embedding (the backfill can add it later).
 */
import { z } from 'zod';
import { env } from '../config/env.js';
import { MEMORY_EMBEDDING_DIMENSIONS } from '../db/schema/memory.js';
import { logger } from './logger.js';

export const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const EMBEDDINGS_TIMEOUT_MS = 15_000;
/** Voyage accepts up to 1000 texts per call; we stay far below. */
export const EMBEDDINGS_BATCH = 64;

export type EmbeddingInputType = 'document' | 'query';

const voyageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        embedding: z.array(z.number()).length(MEMORY_EMBEDDING_DIMENSIONS),
      }),
    )
    .min(1),
  model: z.string().optional(),
  usage: z.object({ total_tokens: z.number().int().nonnegative() }).optional(),
});

/** Test hook: force the feature on or off regardless of env (null resets). */
let override: { apiKey: string; model: string } | null | undefined;
export function setEmbeddingsConfigForTests(config: { apiKey: string; model: string } | null | undefined): void {
  override = config;
}

function config(): { apiKey: string; model: string } | null {
  return override !== undefined ? override : env.voyage;
}

export function isEmbeddingsEnabled(): boolean {
  return config() !== null;
}

export function embeddingsModel(): string | null {
  return config()?.model ?? null;
}

async function callVoyage(texts: string[], inputType: EmbeddingInputType, cfg: { apiKey: string; model: string }): Promise<number[][]> {
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: texts,
      model: cfg.model,
      input_type: inputType,
      output_dimension: MEMORY_EMBEDDING_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(EMBEDDINGS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Voyage answered ${res.status}: ${detail}`);
  }
  const parsed = voyageResponseSchema.parse(await res.json());
  const out: number[][] = new Array<number[]>(texts.length);
  for (const row of parsed.data) {
    if (row.index < texts.length) out[row.index] = row.embedding;
  }
  if (out.some((v) => !v) || out.length !== texts.length) throw new Error('Voyage returned fewer embeddings than texts');
  return out;
}

/**
 * One embedding per text, in order. Returns nulls (never throws) when the feature is off or the
 * call fails, so saving content never depends on Voyage being up.
 */
export async function embedTexts(texts: readonly string[], inputType: EmbeddingInputType = 'document'): Promise<(number[] | null)[]> {
  const cfg = config();
  if (!cfg || texts.length === 0) return texts.map(() => null);
  const out: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += EMBEDDINGS_BATCH) {
    const chunk = texts.slice(i, i + EMBEDDINGS_BATCH).map((t) => t.trim() || '-');
    try {
      out.push(...(await callVoyage(chunk, inputType, cfg)));
    } catch (err) {
      logger.warn({ err, count: chunk.length }, 'voyage embeddings failed; meaning check skipped');
      out.push(...chunk.map(() => null));
    }
  }
  return out;
}

export async function embedText(text: string, inputType: EmbeddingInputType = 'document'): Promise<number[] | null> {
  const [v] = await embedTexts([text], inputType);
  return v ?? null;
}

/** Cosine similarity of two vectors of the same length (0 when either is all zeros). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
