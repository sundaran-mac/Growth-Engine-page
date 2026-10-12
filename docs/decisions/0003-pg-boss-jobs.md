# ADR 0003: pg-boss for jobs (no Redis)

Status: accepted for this build (12 Oct 2026).

## Context

- The app has timed work: Monday 07:00 ideas and note, nightly metrics, publish times,
  24 h approval escalation.
- It also reacts to events: idea starred, brief frozen, approved.
- Jobs must be logged and retryable. A failed publish must not retry silently.

## Decision

- Use **pg-boss**: a job queue that stores jobs inside Postgres (its own schema).
- A separate **worker** process (`apps/api/src/worker.ts`) runs the job handlers.
- No Redis. No BullMQ.
- Job names (from the plan): `kit.refresh`, `ideas.weekly`, `asset.probe`,
  `approval.escalate`, `post.publish`, `whatsapp.reminder`, `metrics.nightly`, `note.monday`.

## Consequences

- One less service to run, back up and secure.
- Jobs and data live in one database, so a job can be created in the same transaction as the data change.
- `post.publish` must turn off automatic retry, and follow the fail-safe rule (ADR 0007).
- If volume grows a lot, we can move to a dedicated queue later. Not needed now.
