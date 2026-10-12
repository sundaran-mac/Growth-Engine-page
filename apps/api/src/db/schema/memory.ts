/**
 * Content memory (BUILD-PLAN section 11, ADR 0009): every idea, brief hook, published caption
 * and dropped Claude draft, for all products. Rows are never deleted.
 *
 * Needs the `pg_trgm` and `vector` (pgvector) extensions, created by migration 0002.
 */
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';
import { contentModeEnum, createdAt, id, memorySourceTypeEnum, updatedAt } from './_shared.js';
import { products } from './people.js';

/** Embedding size of the Voyage model (voyage-4 family, 1024 by default). */
export const MEMORY_EMBEDDING_DIMENSIONS = 1024;

export const contentMemory = pgTable(
  'content_memory',
  {
    id: id(),
    /** Products are archived, never hard deleted, so the memory keeps its owner. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    sourceType: memorySourceTypeEnum('source_type').notNull(),
    /** Idea, brief or post id. Null for a dropped Claude draft. */
    sourceId: uuid('source_id'),
    title: text('title').notNull(),
    /** Hook, caption or the idea's "why". */
    body: text('body'),
    /** `normalise(title + hook)` (or the caption), compared with trigrams. */
    normalized: text('normalized').notNull(),
    /** SHA-256 of the sorted unique key words. */
    fingerprint: text('fingerprint').notNull(),
    angle: text('angle'),
    mode: contentModeEnum('mode'),
    embedding: vector('embedding', { dimensions: MEMORY_EMBEDDING_DIMENSIONS }),
    embeddingModel: text('embedding_model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A dropped draft may repeat an existing fingerprint; ideas and hooks may not.
    uniqueIndex('content_memory_fingerprint_uq')
      .on(t.fingerprint)
      .where(sql`${t.sourceType} in ('idea', 'brief_hook')`),
    // One row per idea, brief (its hook) and post (its caption). Edits update that row.
    uniqueIndex('content_memory_source_uq')
      .on(t.sourceType, t.sourceId)
      .where(sql`${t.sourceId} is not null`),
    index('content_memory_normalized_trgm_idx').using('gin', t.normalized.op('gin_trgm_ops')),
    index('content_memory_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    index('content_memory_product_created_idx').on(t.productId, t.createdAt),
  ],
);
