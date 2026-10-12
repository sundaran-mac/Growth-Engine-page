/**
 * `memory.backfill`: loads everything made before the content memory existed (ideas, brief hooks,
 * published captions) and adds missing embeddings. Idempotent: a row that is already
 * remembered is left alone, so it is safe to run on every API start and by hand
 * (`npm run memory:backfill -w @growth-desk/api`).
 */
import { asc, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { briefs, contentMemory, ideas, posts } from '../../db/schema/index.js';
import { embeddingText, remember, vectorLiteral, withMemoryLock, type MemoryKind } from '../../lib/content-memory.js';
import { EMBEDDINGS_BATCH, embedTexts, embeddingsModel, isEmbeddingsEnabled } from '../../lib/embeddings.js';
import { logger } from '../../lib/logger.js';

/** Rows written per transaction. */
const BATCH = 200;
/** Most rows one run embeds (the rest wait for the next run). */
export const BACKFILL_EMBED_LIMIT = 5_000;

export interface BackfillResult {
  ideas: number;
  hooks: number;
  captions: number;
  /** Rows not stored because another idea or hook already holds the same fingerprint. */
  skipped: number;
  embedded: number;
}

type Outcome = Awaited<ReturnType<typeof remember>>;

async function inBatches<T>(rows: readonly T[], write: (row: T) => Promise<Outcome>): Promise<{ stored: number; skipped: number }> {
  let stored = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db.transaction((tx) =>
      withMemoryLock(tx, async () => {
        for (const row of chunk) {
          const outcome = await write(row);
          if (outcome === 'skipped') skipped += 1;
          else stored += 1;
        }
      }),
    );
  }
  return { stored, skipped };
}

const notRemembered = (type: string, idColumn: ReturnType<typeof sql>) =>
  sql`not exists (select 1 from ${contentMemory} m where m.source_type = ${type} and m.source_id = ${idColumn})`;

export async function backfillMemory(): Promise<BackfillResult> {
  // 1. Ideas, deleted ones too (deleting an idea never frees its title).
  const ideaRows = await db
    .select()
    .from(ideas)
    .where(notRemembered('idea', sql`${ideas.id}`))
    .orderBy(asc(ideas.createdAt), asc(ideas.id));
  const ideaResult = await inBatches(ideaRows, (r) =>
    remember(
      { sourceType: 'idea', sourceId: r.id, productId: r.productId, title: r.title, body: r.summary, angle: r.angle, mode: r.mode, createdAt: r.createdAt },
      db,
    ),
  );

  // 2. Brief hooks, and manual briefs (no idea) even before they have a hook.
  const briefRows = await db
    .select()
    .from(briefs)
    .where(sql`(${briefs.hook} is not null and btrim(${briefs.hook}) <> '' or ${briefs.ideaId} is null) and ${notRemembered('brief_hook', sql`${briefs.id}`)}`)
    .orderBy(asc(briefs.createdAt), asc(briefs.id));
  const hookResult = await inBatches(briefRows, (r) =>
    remember(
      { sourceType: 'brief_hook', sourceId: r.id, productId: r.productId, title: r.title, body: r.hook, mode: r.mode, createdAt: r.createdAt },
      db,
    ),
  );

  // 3. Captions of published posts.
  const captionRows = await db
    .select({ id: posts.id, caption: posts.caption, publishedAt: posts.publishedAt, createdAt: posts.createdAt, productId: briefs.productId, title: briefs.title, mode: briefs.mode })
    .from(posts)
    .innerJoin(briefs, sql`${briefs.id} = ${posts.briefId}`)
    .where(sql`${posts.status} = 'published' and ${posts.caption} is not null and btrim(${posts.caption}) <> '' and ${notRemembered('post_caption', sql`${posts.id}`)}`)
    .orderBy(asc(posts.createdAt));
  const captionResult = await inBatches(captionRows, (r) =>
    remember(
      { sourceType: 'post_caption', sourceId: r.id, productId: r.productId, title: r.title, body: r.caption, mode: r.mode, createdAt: r.publishedAt ?? r.createdAt },
      db,
    ),
  );

  const embedded = await fillMissingEmbeddings();
  const result: BackfillResult = {
    ideas: ideaResult.stored,
    hooks: hookResult.stored,
    captions: captionResult.stored,
    skipped: ideaResult.skipped + hookResult.skipped + captionResult.skipped,
    embedded,
  };
  return result;
}

/** Adds embeddings to rows that have none (the key was added later, or Voyage was down). */
export async function fillMissingEmbeddings(limit = BACKFILL_EMBED_LIMIT): Promise<number> {
  if (!isEmbeddingsEnabled()) return 0;
  const model = embeddingsModel();
  let done = 0;
  while (done < limit) {
    const rows = await db
      .select({ id: contentMemory.id, sourceType: contentMemory.sourceType, title: contentMemory.title, body: contentMemory.body })
      .from(contentMemory)
      .where(sql`${contentMemory.embedding} is null`)
      .orderBy(asc(contentMemory.createdAt))
      .limit(Math.min(EMBEDDINGS_BATCH, limit - done));
    if (rows.length === 0) break;
    const kindOf = (t: string): MemoryKind => (t === 'brief_hook' || t === 'post_caption' ? t : 'idea');
    const vectors = await embedTexts(rows.map((r) => embeddingText(kindOf(r.sourceType), r.title, r.body)));
    let wrote = 0;
    for (const [i, row] of rows.entries()) {
      const v = vectors[i];
      if (!v) continue;
      await db.execute(
        sql`update ${contentMemory} set embedding = ${vectorLiteral(v)}::vector, embedding_model = ${model} where id = ${row.id}`,
      );
      wrote += 1;
    }
    done += wrote;
    // Voyage failed for the whole batch: stop, the next run tries again.
    if (wrote === 0) break;
  }
  return done;
}

/** Dev start-up hook: runs once in the background and only logs. */
export function backfillOnStart(): void {
  backfillMemory()
    .then((r) => logger.info(r, 'content memory backfill done'))
    .catch((err: unknown) => logger.error({ err }, 'content memory backfill failed'));
}
