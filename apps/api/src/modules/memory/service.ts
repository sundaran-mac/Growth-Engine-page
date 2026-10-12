/**
 * Content memory reads for the API: the check endpoint and the stats shown in Settings.
 */
import { eq, sql } from 'drizzle-orm';
import { MEMORY_SOURCE_TYPES, type MemoryCheckResult, type MemorySourceType, type MemoryStats } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { briefs, contentMemory, posts } from '../../db/schema/index.js';
import { MEMORY_THRESHOLDS, checkDuplicate, embeddingText, type MemoryKind } from '../../lib/content-memory.js';
import { embedText, embeddingsModel, isEmbeddingsEnabled } from '../../lib/embeddings.js';

/**
 * Source ids that belong to a brief and must not count as repeats of it: the brief (its hook),
 * the idea it came from, and its posts (a reel and a reminder of one brief share a caption).
 */
export async function briefOwnSourceIds(briefId: string, tx: DbOrTx = db): Promise<string[]> {
  const [brief] = await tx.select({ id: briefs.id, ideaId: briefs.ideaId }).from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!brief) return [briefId];
  const postRows = await tx.select({ id: posts.id }).from(posts).where(eq(posts.briefId, briefId));
  return [brief.id, ...(brief.ideaId ? [brief.ideaId] : []), ...postRows.map((p) => p.id)];
}

export interface CheckContentInput {
  kind: MemoryKind;
  title: string;
  body?: string | null | undefined;
  productId: string;
  excludeIdeaId?: string | undefined;
  excludeBriefId?: string | undefined;
}

/** The read-only check behind POST /memory/check (no lock, nothing stored). */
export async function checkContent(input: CheckContentInput): Promise<MemoryCheckResult> {
  const exclude: string[] = [];
  if (input.excludeIdeaId) exclude.push(input.excludeIdeaId);
  if (input.excludeBriefId) exclude.push(...(await briefOwnSourceIds(input.excludeBriefId)));
  const embedding = await embedText(embeddingText(input.kind, input.title, input.body), 'query');
  return checkDuplicate(
    { kind: input.kind, title: input.title, body: input.body, productId: input.productId, excludeSourceIds: exclude, embedding },
    db,
  );
}

export async function memoryStats(): Promise<MemoryStats> {
  const rows = await db
    .select({
      sourceType: contentMemory.sourceType,
      n: sql<number>`count(*)::int`,
      withEmbedding: sql<number>`count(${contentMemory.embedding})::int`,
      last: sql<Date | null>`max(${contentMemory.createdAt})`,
    })
    .from(contentMemory)
    .groupBy(contentMemory.sourceType);
  const bySourceType = Object.fromEntries(MEMORY_SOURCE_TYPES.map((t) => [t, 0])) as Record<MemorySourceType, number>;
  let total = 0;
  let withEmbedding = 0;
  let last: number | null = null;
  for (const r of rows) {
    bySourceType[r.sourceType] = r.n;
    total += r.n;
    withEmbedding += r.withEmbedding;
    if (r.last) {
      const t = new Date(r.last).getTime();
      last = last === null ? t : Math.max(last, t);
    }
  }
  return {
    total,
    bySourceType,
    withEmbedding,
    embeddings: { enabled: isEmbeddingsEnabled(), model: embeddingsModel() },
    thresholds: { ...MEMORY_THRESHOLDS },
    lastAddedAt: last === null ? null : new Date(last).toISOString(),
  };
}
