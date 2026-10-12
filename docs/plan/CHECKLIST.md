# Growth Desk: build checklist

The lead updates this file after every agent finishes. Legend: [x] done and checked by the lead,
[~] in progress, [ ] not started, [!] blocked (reason written beside it).

## Phase 0: setup
- [x] Clone repo (empty, public) into the working folder
- [x] Read Figma: 13 screens, kit, tokens, functional document
- [x] Save Figma text and structure in `docs/reference/`
- [x] Write and review the build plan (`docs/plan/BUILD-PLAN.md`)

## Phase 1: foundation (parallel)
- [x] FOUNDATION-API: workspaces, contract, API core, DB schema + migrations + seed, auth, storage, Claude, queue, Docker, .env
- [x] FOUNDATION-WEB: Vite app, tokens, shadcn, atomic kit, shell, router, auth, API client, stores
- [x] DOCS: brainstorm, spec, ADRs, platform runbook, Postgres and Docker guide, README

## Phase 2: modules (parallel, vertical slices)
- [x] PRODUCTS: Products, Product kit, Integrations, team
- [x] IDEAS: Ideas board + Claude generate, Plan calendar + freeze, occasions
- [x] MAKE: Briefs, claim check, Claude co-writer, Studio, uploads to R2, render jobs
- [x] GATES: Review checklist + timecode comments, Approvals (two gates, 24 h backup)
- [x] PUBLISH: channel OAuth, connectors (IG, FB, YT, LinkedIn), WhatsApp reminder, schedule, fail safe
- [x] INSIGHTS: Home dashboard, Analytics + value score + Monday note, Sales pipeline, keyword leads
- [x] SETTINGS: per-product Settings, Knowledge documents, posting slots + Schedule view, weekly Claude run + GitHub PR

## Phase 3: verify
- [x] Contract join check: lead curl of every main endpoint through nginx (200), plus E2E across all screens
- [x] Playwright E2E for the four prototype flows (38 tests in 10 files; 37 pass, 1 real bug found)
- [x] Full `docker compose up --build`, login, every screen (E2E shell spec opens all 14 sidebar screens)
- [x] All unit and integration tests green: contract 7, API 532, web 169
- [x] Typecheck and lint green (lint 0 errors, 24 warnings)
- [x] No em-dash in repo (grep, 0 files)
- [x] README verified, final report to Sundaran
- [ ] Commit and push: WAIT for Sundaran's yes

## Lead follow-ups (from agent reports)
- [x] Migration 0001: `assets.loudness_lufs`, `review_comments.parent_id` (GATES request)
- [ ] Seed: channel accounts say connected with no token (screens show the truth: Not connected). Decide: keep or seed as disconnected
- [ ] Seed: Live has no named backup, so kit shows 9/10 (Figma shows 10/10 with backup "To name"). Kept honest
- [x] INSIGHTS metrics.nightly uses PUBLISH `getConnector(platform).fetchMetrics`
- [x] Typecheck api + web clean after all modules (seen by SETTINGS and by the lead on web)
- [x] Env: Studio hand-off URL keys added to `.env` and `.env.example` (MAKE request)
- [x] R2 bucket CORS script `npm run storage:cors -w @growth-desk/api` (PUT + ETag for multipart)
- [x] Web test RequireAuth: removed stale "Being built" assertion
- [x] Loudness: contract `makeAssetSchema.loudnessLufs`, `PATCH /assets/:id`, Studio field (MAKE)
- [x] GATES reads loudness for the checklist + real reply threads (INTEGRATION agent)
- [~] MinIO CORS: single PUT upload works in E2E (flow A); a real browser multipart (over 50 MB) is not tested yet
- [x] Env: LINKEDIN_API_VERSION, META_GRAPH_VERSION, YOUTUBE_PRIVACY_STATUS added (PUBLISH request)
- [x] Integrations page: use PUBLISH's shared `ConnectChannelButton` instead of a second copy (no duplicated logic) (FOLLOW-UPS agent)
- [x] Best window from week 5 (learned from metrics per channel and audience) not built yet; starting rule used (FOLLOW-UPS agent)
- [ ] Move time zone short names (IST, SGT, GST) from features/publish/format.ts into lib/ if other screens need them
- [x] Token `joy-badge` (#fff6ea) added; ideas M4 chip uses it
- [x] API build excludes `test-support.ts`
- [x] Plan "things to fix": cross-product check ("no Pulse piece in week 3") not built; only own product (FOLLOW-UPS agent)
- [x] BUG fixed: origin check never exempted `/api/v1/webhooks/` (Meta webhooks got 403). Now matches the full path; 5 tests
- [x] Notification bell: click marks read, "Mark all read" button; hooks moved to `lib/shell-queries.ts`
- [ ] Promote `features/insights/components/Segmented.tsx` to the shared kit when a second screen needs it
- [x] Per-product Claude monthly cap enforced, not only shown (FOLLOW-UPS agent)
- [x] `getObjectBytes` in lib/storage, remove settings duplicate (FOLLOW-UPS agent)
- [x] Weekly run stuck in `running` after a worker crash gets cleaned up (FOLLOW-UPS agent)
- [ ] Optional: `weekly_run` notification kind (needs a Postgres enum migration); `ideas_ready` and `system` used for now
- [x] QA bug 1: Integrations Connect called `/oauth/instagram/start` (API takes meta|google|linkedin); Connect shown to admin only but API allows editor (FOLLOW-UPS agent)
- [x] QA bug 2: signed Product kit has no way to Ideas (FOLLOW-UPS agent)
- [x] QA bug 3: locked brief now shows "Open in Studio" / "Open review" / "Open publish"
- [x] QA note 4: Home "Review" goes to Approvals. Kept: it is the Figma label and the prototype flow (Home, Review, Approvals)
- [x] Root `npm run test:e2e`; `.gitignore` covers e2e auth state and reports

## Phase 4: ideas unique forever (Sundaran, 20:23)
- [x] Design: content memory in Postgres, 3 layers (fingerprint, trigram, pgvector), ADR 0009, plan section 11
- [x] MEMORY agent: migration 0002, lib/content-memory, generation with coverage map + retries, human duplicate checks, backfill, UI, docs
- [x] Lead: rebuild Docker, all suites, E2E again (E2E data now unique per run; 38/38 twice)
- [x] Web `ApiError.extensions` keeps extra problem fields (for example `matches`)
- [x] Publish: live "similar caption" warning in the post editor
