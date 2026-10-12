# ADR 0001: Stack and monorepo

Status: accepted for this build (12 Oct 2026). Source: `docs/plan/BUILD-PLAN.md` section 2.

## Context

- One developer (Sundaran) owns the app end to end. He is strong in JavaScript, React, Node, Express.
- The web app and the API must share the same data shapes.
- The app must run on a laptop with one command.

## Decision

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `apps/*` (api, web), `packages/*` (contract) |
| Language | TypeScript, strict, everywhere |
| Web | Vite + React 18, Tailwind CSS v3, shadcn/ui (Radix), React Router v6, react-hook-form + zod, Phosphor icons, Recharts |
| API | Node 22 + Express 5 |
| Shared contract | `packages/contract`: zod schemas, types, enums used by both API and web |
| Database | PostgreSQL 16 |
| Logs | pino + pino-http with a request id |
| Tests | Vitest, Supertest, Testing Library, Playwright |
| Runtime | Docker Compose: postgres, minio, api, worker, web (nginx) |

## Consequences

- One `npm install` at the root. No extra tool (no Turborepo, no pnpm).
- A change to an API shape is a change in `packages/contract`. TypeScript then shows every place to fix.
- Express is familiar, so less learning. Postgres and Docker are new for Sundaran; see
  `docs/runbooks/postgres-and-docker-for-sundaran.md`.
- Hosting is not decided yet (decision 05 in the brainstorm).
