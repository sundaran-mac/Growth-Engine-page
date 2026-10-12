# Content memory: no idea is used twice

> **What this is:** the store that stops Growth Desk from repeating an idea, for any product, forever.
> **What you get:** how it works, how to tune it, how to fill it, and how to fix common problems.
> **What you must keep ready:** Docker running. A Voyage AI key only if you want the "same meaning" check.

Decision: ADR 0009. Spec: BUILD-PLAN section 11.

## What it is

- One Postgres table: `content_memory`.
- It holds every idea (Claude or human), every brief hook, every published caption, and every
  Claude draft that was dropped as a repeat.
- It is global. All products share it. Rows are never deleted.
- Deleting an idea is a soft delete (`ideas.deleted_at`). The idea leaves the board. Its title
  stays in the memory, so nobody can use it again.

## The three checks

| Check | Catches | How | Repeat at | Similar at |
|---|---|---|---|---|
| Fingerprint | Same words in any order ("60 seconds with Elan" = "Elan, sixty seconds!") | Clean the text, sort the key words, SHA-256 | always | - |
| Text | Reworded titles and hooks | Postgres `pg_trgm` trigram similarity | 0.55 | 0.40 |
| Meaning | Same idea, other words | `pgvector` cosine on Voyage embeddings | 0.90 | 0.83 |

- **Repeat** blocks the save (`409 IDEA_DUPLICATE`).
- **Similar** asks a person for a reason of 10+ characters (`409 IDEA_SIMILAR`). The reason goes
  to the audit log. Claude drafts that are "similar" are simply dropped.
- A brief hook that repeats **another brief's** hook is blocked. A similar hook only warns.
- Captions are never blocked (a reel and a reminder of one brief share text). Publish can ask
  `POST /api/v1/memory/check` with `kind: post_caption` to flag a caption close to another brief.

New Postgres words, in short:

- **Extension**: an add-on inside Postgres. `pg_trgm` compares text. `vector` (pgvector) stores
  embeddings. Migration `0002_content_memory.sql` turns both on.
- **Trigram**: a 3-letter piece of a word. "clock" gives "  c", " cl", "clo", "loc", "ock", "ck ".
  Two texts that share many pieces score close to 1.
- **Embedding**: a list of 1024 numbers that stands for the meaning of a text. Close lists mean
  close meaning.
- **Advisory lock**: a named lock inside Postgres. Every save that must stay unique takes it, so
  two saves at the same moment cannot both pass the check.

## Generate with Claude

1. The prompt gets a coverage map (counts by mode, audience, behaviour and twist, all products),
   the 30 closest past ideas, and a rotating "unexplored" seed.
2. Claude returns an `angle` per idea: `audience / behaviour / twist`. Cards show it.
3. We ask for 50% more than needed, drop repeats, and ask again for the missing number (2 extra
   rounds at most). The toast says how many were dropped as repeats.

## Tune the thresholds

All numbers live in one place: `MEMORY_THRESHOLDS` in `apps/api/src/lib/content-memory.ts`.

- Too many good ideas blocked: raise `textDuplicate` (for example 0.60).
- Repeats still get through: lower `textSimilar` (keep it at 0.30 or more).
- Check a pair before you change anything (Postgres shell):

```sql
-- How close are two titles? (same cleaning as the app: lower case, no stop words)
select similarity('their clock not yours', 'their time not yours');
```

Settings, tab "Claude and weekly run", shows the memory size, the thresholds, and whether the
meaning check is on.

## Turn on the meaning check (optional)

1. Get a key at https://dash.voyageai.com.
2. In `.env`: `VOYAGE_API_KEY=...`. Leave `VOYAGE_MODEL` empty (default `voyage-4`, 1024 numbers).
3. Restart the API, then run the backfill once. It adds embeddings to old rows.

Without the key, the fingerprint and text checks still run. A Voyage error never blocks a save;
the row is stored without an embedding and the next backfill adds it.

## Fill the memory (backfill)

Loads old ideas, brief hooks and published captions, then adds missing embeddings. Safe to run
again and again: rows already there are skipped.

```bash
npm run memory:backfill -w @growth-desk/api
```

- In development, the API runs it once on start by itself.
- In the worker, the job `memory.backfill` does the same (queue it by hand when needed).

## The Postgres image

Postgres runs on `pgvector/pgvector:0.8.7-pg16`. It is the same Postgres 16 plus the `vector`
add-on, and it uses the same data volume.

The old image was Alpine based; this one is Debian based. Text sorting rules differ between them,
so after the switch, rebuild the text indexes once (only the first time):

```bash
docker compose up -d postgres
docker exec growth-desk-postgres-1 psql -U growthdesk -d growth_desk -c "REINDEX DATABASE growth_desk"
```

## Common problems

| You see | Why | Fix |
|---|---|---|
| `type "vector" does not exist` in a migration | Postgres is still on the old image | `docker compose up -d postgres`, then migrate again |
| Every Claude draft is dropped | The memory already covers that angle | Change the modes, or add audiences and behaviours to the kit |
| "Meaning check: Off" in Settings | No `VOYAGE_API_KEY` | Add the key, restart, run the backfill |
| Backfill says "N skipped as repeats" | Two old ideas share a fingerprint | Nothing to do; the first one is remembered |
