# ADR 0002: Drizzle ORM and SQL migrations

Status: accepted for this build (12 Oct 2026).

## Context

- The database is Postgres. Tables change over time, so we need **migrations**.
  A migration is a file of SQL that changes the tables, run once, in order.
- MongoDB has no fixed schema, so this step is new for Sundaran.
- We want typed queries in TypeScript and SQL that a person can read.

## Decision

- Use **Drizzle ORM** for queries and table definitions (in TypeScript).
- Use **drizzle-kit** to generate **plain SQL migration files** from the table definitions.
- Migration files are committed to git and reviewed like code.
- Migrations run on start of the API container (or by a script; see the README).

## Consequences

- Queries look close to SQL, so learning Drizzle also teaches SQL.
- Every schema change is a readable `.sql` file in git. Easy to review.
- Never edit a migration that already ran on a shared database. Add a new one.
- Alternatives not chosen: Prisma (its own schema language, heavier client),
  raw SQL only (no types), Mongoose-style ODM (not for Postgres).
