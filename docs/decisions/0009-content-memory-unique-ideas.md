# 0009: Content memory keeps every idea unique, forever

## Context
Sundaran asked that Claude never repeats an idea, for any product, even after 1000 days. Claude has
no memory between calls. Its prompt cannot hold years of ideas. Repo files are not transactional
and are hard to query.

## Decision
- One `content_memory` table in Postgres holds every idea, brief hook, published caption and
  dropped draft, for all products. Rows are never deleted.
- Three duplicate checks: a normalised fingerprint (unique index), `pg_trgm` text similarity, and
  `pgvector` meaning similarity with Voyage AI embeddings (optional key; off without it).
- Claude gets a coverage map and the closest past ideas, so it avoids them before we check.
- Inserts are serialised with an advisory lock; the unique index is the final guard.

## Consequences
- Good: works across products and years; one source of truth; cheap (no extra service).
- Good: without `VOYAGE_API_KEY` the app still blocks exact and reworded repeats.
- Cost: an embeddings call per idea when the key is set (small).
- Trade-off: thresholds need tuning after real use. They live in one config file.
- Postgres image changes to `pgvector/pgvector:pg16`.
