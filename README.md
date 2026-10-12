# Growth Desk

One web app to **plan, make, approve, publish, measure and sell**, for every Humini product.
First product: Humini LIVE.

- Claude drafts. People decide. Tools do the repeating.
- Nothing goes public without two human gates: **claims** (product owner) and **brand** (Elan).
- Every post has a tracked link, so every number ends in an install or a signed partner.

13 screens, 2 human gates, 5 channels (Instagram, Facebook, YouTube, LinkedIn, WhatsApp).
Read the spec: [`docs/specs/001-growth-desk.md`](docs/specs/001-growth-desk.md).

> Status: v1 built on 12 Oct 2026. Docker run, unit, integration and E2E tests all pass
> (see `docs/plan/CHECKLIST.md`).

## Stack

Vite + React 18 + TypeScript, Tailwind + shadcn/ui, Zustand, TanStack Query ·
Node 22 + Express 5 · PostgreSQL 16 (pgvector image) + Drizzle · pg-boss jobs ·
Cloudflare R2 (MinIO locally) · Claude via `@anthropic-ai/sdk` · Docker Compose.
Why: [`docs/decisions/`](docs/decisions/).

## Quick start (everything in Docker)

You need: Docker Desktop, running.

1. Fill `.env` (it already exists, with every key and empty values). Empty is fine to start:
   local Postgres and MinIO use safe development defaults, and each missing third-party key
   turns only that feature off with a clear message in the app. Fill these when you have them:

   | Key group | Turns on | Where to get it |
   |---|---|---|
   | `ANTHROPIC_API_KEY` | Claude ideas, briefs, notes, weekly run | console.anthropic.com |
   | `R2_*` + `STORAGE_DRIVER=r2` | Real storage (needed for Instagram and Facebook) | Cloudflare R2 |
   | `META_*`, `GOOGLE_*`, `LINKEDIN_*`, `OAUTH_REDIRECT_BASE_URL` | Posting to channels | [`docs/runbooks/social-platform-setup.md`](docs/runbooks/social-platform-setup.md) |
   | `GITHUB_TOKEN` | Kit refresh, spec sync, weekly pull requests | GitHub fine-grained token |
   | `VOYAGE_API_KEY` | Meaning check for unique ideas | [`docs/runbooks/content-memory.md`](docs/runbooks/content-memory.md) |

   For production, also set `NODE_ENV=production`, `SESSION_SECRET` and `ENCRYPTION_KEY`
   (the app refuses to start without them).

2. Start all services and build the images:

   ```bash
   npm run docker:up
   ```

   This starts postgres, minio, minio-init, api, worker and web. The API runs migrations
   and the development seed on start.

3. Open http://localhost:8080

4. Sign in with a seeded user. Password for all of them: `growthdesk-dev`
   (`SEED_USER_PASSWORD` changes it).

   | Email | Role |
   |---|---|
   | `jeeva@example.com` | Editor (runs the engine) |
   | `elan@example.com` | Admin, brand approver |
   | `liveowner@example.com` | Owner of Humini Live (claims approver) |
   | `sundaran@example.com` | Admin |
   | `tamil@example.com`, `tester@example.com`, `developer@example.com` | Team members |

5. After you fill the R2 keys once, set the bucket CORS for browser uploads:
   `npm run storage:cors -w @growth-desk/api`.

Ports: web 8080, API 4000, Postgres 5433 (5432 is used by another project on this Mac),
MinIO 9000 (console 9001).

Stop it: `npm run docker:down`.

## Local dev without Docker for the apps

Infra (Postgres, MinIO) in Docker. API, worker and web on your Mac with hot reload.

You need: Node 22 (see `.nvmrc`; `engines` asks for `>=22.12.0`), npm, Docker Desktop.

```bash
npm install
cp .env.example .env
npm run docker:infra     # postgres + minio + minio-init
npm run db:migrate       # create the tables
npm run db:seed          # sample data (development only)
npm run dev              # builds the contract, then runs api + worker + web together
```

The web dev server is Vite on http://localhost:5173 (it proxies `/api` to the API on port 4000).
Stop the Docker `api`, `worker` and `web` containers first, so the ports are free.

New to Postgres or Docker? Read
[`docs/runbooks/postgres-and-docker-for-sundaran.md`](docs/runbooks/postgres-and-docker-for-sundaran.md).

## Scripts (root)

| Script | What it does |
|---|---|
| `npm run dev` | Build `packages/contract`, then run API, worker and web with watch |
| `npm run build` | Build contract, API and web |
| `npm run typecheck` | TypeScript check in every workspace |
| `npm run lint` / `lint:fix` | ESLint |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Unit and integration tests: contract, API, web |
| `npm run db:generate` | Make a new SQL migration from the Drizzle table definitions |
| `npm run db:migrate` | Apply migrations that have not run yet |
| `npm run db:seed` | Load sample data (development only) |
| `npm run docker:infra` | Start Postgres, MinIO and the bucket setup |
| `npm run docker:up` | Start all services in Docker, with build |
| `npm run docker:down` | Stop all services |
| `npm run test:e2e` | Playwright end-to-end tests |

Workspace extras: `npm run db:studio -w @growth-desk/api` opens Drizzle Studio (a GUI for the database).

## Repo layout

```
apps/
  api/            Express API + pg-boss worker
    src/modules/    one folder per module (routes, service, repo, tests)
    src/jobs/       job handlers
    src/connectors/ social platform adapters
    src/db/         schema, migrations, seed
  web/            Vite + React app
    src/pages/      one page per screen
    src/features/   API hooks and module components
    src/components/ shared UI kit
packages/
  contract/       zod schemas, types and enums shared by API and web
e2e/              Playwright end-to-end tests
docs/             brainstorm, spec, decisions, runbooks, plan, reference
```

## Docs

| Folder | What is inside |
|---|---|
| [`docs/brainstorms/`](docs/brainstorms/) | The problem, options, open decisions |
| [`docs/specs/`](docs/specs/) | The product spec: screens, rules, data model |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records (ADRs) |
| [`docs/runbooks/`](docs/runbooks/) | How-to guides: social platform setup, content memory, Postgres and Docker |
| [`docs/plan/`](docs/plan/) | The build plan |
| [`docs/reference/`](docs/reference/) | The Figma functional document and UI structure |

## Testing

```bash
npm test                                  # all unit and integration tests
npm run test -w @growth-desk/api          # API only (integration tests need Postgres running)
npm run test -w @growth-desk/web          # web only
npm run typecheck && npm run lint         # static checks
```

End-to-end (Playwright), against the Docker app on port 8080:

```bash
npm run docker:up
npm run test:e2e
```

More in [`e2e/README.md`](e2e/README.md).

## Rules for contributors

- Every change lands on `main` through a Pull Request.
- No secrets in git. `.env` stays local.
- No em-dash characters anywhere (code, docs, UI copy).
