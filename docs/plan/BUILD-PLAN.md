# Growth Desk: build plan (v1, reviewed)

Status: approved by Sundaran in advance for this build (12 Oct 2026). Owner: Sundaran V.
Every agent reads this file first. It is the single source of truth for structure, names and
file ownership. If code must leave this plan, stop and report to the lead.

## 1. What we build

Growth Desk is the marketing desk for every Humini product (first: Humini LIVE). One place to
plan, make, approve, publish (to many social channels), measure and sell.

- Functional source: `docs/reference/figma-functional-doc.md` (read it fully).
- UI source: Figma file `sUxvEcixtr0XhtgLdNhWZU`, page `237:673` "Growth Desk - app UI and
  prototype". Frame ids are in section 6. Structure dump: `docs/reference/figma-ui-metadata.xml`.
- 13 screens, 10 stages, 2 human gates, 5 channels.

## 2. Stack (fixed)

| Layer | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces (`apps/*`, `packages/*`) | npm is installed, no extra tool |
| Language | TypeScript strict everywhere | one type system front to back |
| Web | Vite + React 18 + TypeScript | user choice |
| Styling | Tailwind CSS v3 + shadcn/ui (Radix) + tokens from Figma variables | user choice |
| Client state | Zustand (UI and session state only) | user choice |
| Server state | TanStack Query v5 | caching, retries, no server data in Zustand |
| Routing | React Router v6 (data-less, lazy routes) | standard |
| Forms | react-hook-form + zod (schemas from `@growth-desk/contract`) | one validation source |
| Icons | `@phosphor-icons/react` (Figma uses Phosphor names) | exact match to design |
| Charts | Recharts | standard |
| API | Node 22 + Express 5 + TypeScript | Sundaran knows Express |
| Validation | zod, shared through `packages/contract` | API and web use the same shapes |
| DB | PostgreSQL 16 | user choice |
| ORM and migrations | Drizzle ORM + drizzle-kit SQL migrations | SQL-close, typed, readable migrations |
| Jobs | pg-boss (queue inside Postgres) | schedules, retries, logs; no Redis needed |
| Storage | Cloudflare R2 via `@aws-sdk/client-s3` (S3 API). MinIO in Docker for local dev | user choice; local runs with no keys |
| Uploads | presigned PUT (single) and S3 multipart (large video) direct from browser | big video never passes the API |
| AI | `@anthropic-ai/sdk`, model from env `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | Claude drafts words only |
| Auth | email + password (argon2id), server session in Postgres, httpOnly cookie | simple, secure, revocable |
| Logging | pino + pino-http, request id | structured logs |
| Tests | Vitest (unit + integration with real Postgres), Supertest, Testing Library, Playwright E2E | standard |
| Runtime | Docker Compose: postgres, minio, api, worker, web (nginx) | one command to run |

## 3. Repo layout and ownership

```
package.json            (root workspaces, scripts)          owner: FOUNDATION-API
docker-compose.yml, docker/, .env, .env.example             owner: FOUNDATION-API
packages/contract/      zod schemas + types + enums          owner: FOUNDATION-API (only)
apps/api/
  src/app.ts, server.ts, worker.ts, config/, db/, lib/, middleware/   owner: FOUNDATION-API
  src/modules/<module>/  routes.ts service.ts repo.ts *.test.ts      owner: module agent
  src/modules/index.ts   (registers every module router; pre-created) owner: FOUNDATION-API
  src/jobs/index.ts      (registers every job handler; pre-created)   owner: FOUNDATION-API
  src/jobs/<module>.ts                                               owner: module agent
  src/connectors/        (social platform adapters)                  owner: PUBLISH agent
apps/web/
  src/styles, src/lib, src/stores, src/app (router, providers, shell) owner: FOUNDATION-WEB
  src/components/ui/        shadcn primitives                         owner: FOUNDATION-WEB
  src/components/atoms|molecules|organisms/  shared kit               owner: FOUNDATION-WEB
  src/features/<module>/    api hooks + module components             owner: module agent
  src/pages/<Screen>Page.tsx (pre-created stubs, routes wired)        owner: module agent
e2e/                    Playwright                                     owner: QA agent
docs/                                                                  owner: DOCS agent (+ lead)
```

Rule: two agents never edit the same file. A module agent who needs a change in a foundation
file (contract, shell, shared atom) reports it to the lead instead of editing.

## 4. Shared conventions

- API base path `/api/v1`. JSON only. Dates as ISO strings (UTC). Money: never stored.
- Errors: RFC 7807 `application/problem+json`: `{ type, title, status, detail, code, errors? }`.
  `code` is a stable SCREAMING_SNAKE string (`CLAIM_CHECK_FAILED`, `GATE_NOT_ALLOWED`...).
- Lists: `GET` returns `{ items: T[], total: number }`, query `limit` (max 100) and `offset`.
- IDs: uuid (`gen_random_uuid()`). Human codes: brief `code` like `REEL-031`, `POSTER-008`.
- Every mutating action writes `audit_logs` (actor, action, entity, entity_id, before, after).
- Auth: cookie `gd_session` (httpOnly, SameSite=Lax, Secure in prod). Mutations also require
  `Origin` to match `WEB_ORIGIN`. Rate limit on `/auth/*`.
- RBAC: global `role` in (`admin`, `editor`, `member`, `viewer`); per product membership
  `product_role` in (`owner`, `backup`, `maker`, `reviewer`); user flag `is_brand_approver`.
- Config: `apps/api/src/config/env.ts` parses env with zod. In production every secret is
  required. In development, missing third-party keys turn that feature off with a clear
  message (never crash), and local infra uses Docker defaults.
- Secrets for social channels (OAuth tokens) are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`).
- Claude never approves. No post is scheduled unless both gates are approved for that version.
- Fail safe: a failed publish is not retried silently. Post goes to `failed`, the brief goes back
  to `scheduled`, the owner gets a notification, the channel account is marked. Manual retry.
- No em-dash characters anywhere (code, comments, docs, UI copy).

## 5. Data model (13 records from the doc, plus system tables)

Domain: `products`, `product_kits` (promise, behaviours jsonb [{text, specRef}], never_say text[],
not_built jsonb, audiences text[], activation_event, truth_sources text[], signed_by, signed_at,
version), `occasions`, `ideas` (title, mode M1..M7, channels[], fit_score, status
new|starred|briefed|parked, product_id, source claude|human), `plans` (product, month, status
draft|frozen), `plan_items` (plan, date, idea or brief, mode, channel), `briefs` (code, product,
idea, title, mode, stage idea|brief|frozen|made|reviewed|approved|scheduled|live, hook, beats
jsonb, ask, ratios[], caption_languages[], channels[], approver ids, owner, version, claude
suggestions jsonb), `assets` (brief, kind video|poster|caption|cutdown, ratio, storage key, mime,
size, duration, status uploading|ready|failed, licence, consent, ai_generated), `render_jobs`,
`review_checklists` (brief, version, items jsonb), `review_comments` (brief, author, timecode_ms,
body, resolved), `approvals` (brief, version, gate claims|brand, approver, backup, decision
pending|approved|changes_requested, note, due_at, escalated_at, decided_at), `posts` (brief,
channel_account, asset, caption, language, scheduled_at, audience_tz, status
draft|scheduled|publishing|published|failed|manual_pending, external_id, live_url, tracked_url,
error), `metric_snapshots` (post, date, reach, saves, shares, comments, clicks, installs,
activations, value_score), `people` = `users` + `product_members`, `leads` (organisation, product,
source_post, source_text, who, first_offer, owner, stage new|qualified|talking|pilot|review|won|
lost, next_step, next_step_at), `lead_activities`, `channel_accounts` (platform
instagram|facebook|youtube|linkedin|whatsapp, display name, status connected|needs_approval|
manual|disconnected|error, allowed_actions[], encrypted tokens, expires_at).
System: `users`, `sessions`, `product_members`, `audit_logs`, `notifications`, `claude_usage`
(product, month, tokens in/out, cap), `keyword_rules` (product, platform, keyword, reply text,
link), pg-boss own schema.

Value score: `(saves*3 + shares*4 + clicks*5 + installs*20 + activations*40) / reach * 1000`.

## 6. Screens (Figma frame id, route, module owner)

| # | Screen | Frame | Route | Module |
|---|---|---|---|---|
| 00 | Home | 239:675 | `/` | INSIGHTS |
| 01 | Products | 239:888 | `/products` | PRODUCTS |
| 02 | Product kit | 239:1081 | `/products/:productId/kit` | PRODUCTS |
| 03 | Ideas | 240:847 | `/ideas` | IDEAS |
| 04 | Plan | 240:1053 | `/plan` | IDEAS |
| 05 | Brief | 240:1314 | `/briefs`, `/briefs/:briefId` | MAKE |
| 06 | Studio | 241:990 | `/studio/:briefId` | MAKE |
| 07 | Review | 241:1193 | `/review`, `/review/:briefId` | GATES |
| 08 | Approvals | 241:1363 | `/approvals` | GATES |
| 09 | Publish | 242:1131 | `/publish`, `/publish/:briefId` | PUBLISH |
| 10 | Analytics | 242:1302 | `/analytics` | INSIGHTS |
| 11 | Sales | 242:1486 | `/sales` | INSIGHTS |
| 12 | Integrations | 242:1642 | `/integrations` | PRODUCTS |
| - | Sign in | none (placeholder in house style) | `/login` | FOUNDATION-WEB |

Kit frame `237:674` (icons, nav item, buttons, stat tile, avatar). Tokens (Figma variables):
surface/base `#fbf9f3`, surface/card `#ffffff`, surface/sunken `#f2eee4`, text/primary
`#1a1714`, text/muted `#9c938a`, border/hairline `#e6e0d4`, border/strong `#d4ccbc`, heart/joy
`#ff9a00`, heart/joy-soft `#fff1dc`, heart/joy-text-dark `#96570a`, heart/care `#3e7568`,
heart/care-soft `#e5f1ec`, heart/care-text-dark `#2d544b`, media/canvas `#0e0d0c`, media/text
`#f5f2ec`. Sidebar is near-black, active nav item is joy orange, pill buttons.

## 7. Modules (API + web vertical slices)

| Agent | API modules | Web pages | Jobs |
|---|---|---|---|
| PRODUCTS | products, kits (sign, refresh from repo via GitHub API), members, integrations listing, users/team | Products, Product kit, Integrations | `kit.refresh` |
| IDEAS | ideas (generate with Claude, star, park, brief-from-idea), plans, plan items, occasions, claude service (`lib/claude` is foundation; prompts here) | Ideas, Plan | `ideas.weekly` (Mon 07:00) |
| MAKE | briefs (CRUD, stage machine, claim check lint, freeze, Claude co-writer), assets (presign, multipart, complete), render jobs (hand-off records, status) | Briefs list, Brief, Studio | `asset.probe` |
| GATES | review checklist (auto checks), comments at timecode, send for approval, approvals (two gates, 24 h escalation to backup, decision log) | Review, Approvals | `approval.escalate` |
| PUBLISH | channel accounts (OAuth connect for Meta, Google, LinkedIn), posts (fan out, best window, tracked UTM link, schedule, post now, manual retry), connectors | Publish, connect buttons used by Integrations | `post.publish`, `whatsapp.reminder` |
| INSIGHTS | dashboard (home), metrics (nightly pull, value score), Monday note (Claude), leads (pipeline, activities), keyword webhook (IG comments to lead + DM) | Home, Analytics, Sales | `metrics.nightly`, `note.monday` |

Brief stage machine: idea -> brief -> frozen -> made -> reviewed -> approved -> scheduled -> live.
Freeze blocked while the claim check has a red flag. "Send for approval" needs the checklist
complete. Approve on both gates moves to approved and creates draft posts. Request changes moves
back to brief with the note and bumps the version (old approvals become stale).

## 8. Phases and order

1. Phase 1 (parallel): FOUNDATION-API, FOUNDATION-WEB, DOCS.
2. Phase 2 (parallel, after phase 1): PRODUCTS, IDEAS, MAKE, GATES, PUBLISH, INSIGHTS.
3. Phase 3: QA (Playwright E2E + Docker full run), lead fixes, final checklist.

## 9. Plan review (adversarial pass, done before build)

| Risk found | Fix in plan |
|---|---|
| Six agents editing the router files at once | Foundation pre-creates `modules/index.ts`, `jobs/index.ts`, routes and page stubs; module agents own only their folders |
| Contract drift between API and web | Only FOUNDATION-API edits `packages/contract`; module agents add module schemas in `packages/contract/src/modules/<module>.ts` which the foundation pre-creates as empty files they own |
| App cannot run with empty `.env` | Local infra defaults in Compose; features needing keys switch off with a clear UI state |
| Large video through API | Browser uploads straight to R2 with presigned multipart |
| Silent publish failure | Fail-safe rule in section 4 |
| Platform approval not granted | Connector reports `needs_approval`; UI shows it; WhatsApp is reminder only |
| Token leak | Tokens encrypted, never sent to the web, audit log on connect and disconnect |
| Claude cost | `claude_usage` with monthly cap per product (`CLAUDE_MONTHLY_TOKEN_CAP`) |
| Seed data looks like real records | Seed is marked sample data, only in development |
| Node 26 locally vs 22 in Docker | Engines `>=22`; Docker uses node:22-alpine |

## 10. Scope addition from Sundaran (12 Oct 2026, 19:30)

| Need | How we build it |
|---|---|
| Many products in one engine | Already the model: every record has `product_id`; the product switcher scopes every screen. |
| Product context from documents | New "Knowledge" per product: upload files (PDF, DOCX, MD, TXT), add URLs, or sync spec files from the product repo. Text is extracted, Claude writes a short summary per document, and pinned documents plus summaries form the context for every Claude call. |
| Every Monday Claude reviews ideas and makes PRs per product | Weekly run per product (day and time set in Settings, default Monday 07:00 in the product timezone). It (1) drafts new ideas from kit + knowledge + last week's numbers, (2) reviews existing ideas (re-scores fit, flags stale ones), (3) writes the Monday note, and (4) if the product has a GitHub repo and `weekly_pr_enabled`, opens a GitHub pull request in that repo with `docs/growth/weekly/<date>.md` (ideas, scores, note, proposed plan). Inside the app the same output shows as a "Weekly proposal" for the team to accept. Both readings of "PRs" are covered. Idempotent per product and week; manual "Run now". |
| Posting schedule per product and per channel | `posting_slots`: weekday + local time + audience time zone per platform, plus a launch date (first post day). Approved posts auto-take the next free slot on each channel (setting `auto_schedule`). Publish shows the slot it picked and lets you change it. A "Schedule" calendar view shows what goes out when, per channel. |
| Settings per product | New `/settings` screen with tabs: General, Knowledge, Posting schedule, Channels, Claude and weekly run, Approvals, Tracking. It always shows the product chosen in the switcher. Switching product reloads settings for that product. No Figma frame exists; we build it in the house style and mark it as a placeholder design. |

New module agent: SETTINGS. New tables: `product_settings`, `posting_slots`, `product_channels`,
`product_documents`, `weekly_runs`.

## 11. Scope addition: ideas are unique forever, across all products (12 Oct 2026, 20:23)

Sundaran's rule: Claude must never suggest the same idea twice, for any product, even 1000 days
later. No duplicate posts. Decision (ADR 0009): a **content memory** inside Postgres, with three
layers of duplicate checks. Not repo files and not Claude's own memory: the database is the only
place that is transactional, queryable, backed up, and shared by every product and every worker.

| Layer | What it catches | How |
|---|---|---|
| 1. Fingerprint | Exact and near-exact repeats ("60 seconds with Elan" vs "60 Seconds With Elan!") | Normalise text (lower case, strip punctuation, stop words, number words), sort key tokens, SHA-256. Unique index. |
| 2. Text similarity | Reworded titles and hooks | `pg_trgm` trigram similarity on normalised title + hook, GIN index. Duplicate at >= 0.55, "similar" at >= 0.40. |
| 3. Meaning similarity | Same idea in different words | `pgvector` embeddings (Voyage AI, Anthropic's recommended embeddings partner, key `VOYAGE_API_KEY`, optional). Cosine >= 0.90 duplicate, >= 0.83 similar. HNSW index. Off when no key: layers 1 and 2 still run. |

- `content_memory` table: every idea ever made (Claude or human), every brief hook, every
  published caption, and every Claude draft that was dropped as a duplicate. Rows are never
  deleted. Deleting an idea is a soft delete (`deleted_at`), so the memory stays.
- Checks are global (all products), because two products must not post the same idea either.
- Generation keeps ideas fresh for years: the prompt gets a coverage map (which angles, modes,
  audiences, occasions and behaviours are already used, with counts), the most similar past
  ideas for this run, and a rotating "unexplored angle" seed. Claude returns an `angle` tag per
  idea. The service asks for more than needed, drops duplicates, and asks again (max 2 rounds).
- Race safety: inserts run in one transaction under a Postgres advisory lock for the memory, and
  the unique fingerprint index is the last line of defence.
- Humans: a manual idea or brief that is a duplicate is blocked with `IDEA_DUPLICATE` and a link
  to the earlier one; a "similar" one shows a warning and needs a short reason to continue.
- Posts: one post per channel per brief version is already enforced; the published caption also
  goes into memory.
- Postgres image changes to `pgvector/pgvector:pg16` (same Postgres 16, data volume compatible).
