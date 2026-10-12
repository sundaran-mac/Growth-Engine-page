# Module briefs (phase 2)

Each module agent owns a vertical slice: API module + contract module file + job file + web
feature folder + its pages + its tests. Read `BUILD-PLAN.md` first. Figma frames are in plan
section 6; match them closely, using the shared atomic kit (never re-create an atom; if one is
missing, build it inside your feature folder and report it so the lead can promote it).

Every module, every time:
- Contract: add request and response schemas to `packages/contract/src/modules/<module>.ts`.
- API: `apps/api/src/modules/<area>/` with routes, service, repo, tests. Validate every input
  with zod. Check RBAC. Write the audit log on every mutation. Return problem+json errors.
- Web: `apps/web/src/features/<module>/` (query hooks, components), fill your page stubs.
  Loading skeletons, empty states, error states with retry, optimistic updates where safe,
  toasts on success and failure, keyboard access, confirm dialogs for destructive actions.
- Tests: API integration tests (Supertest + real Postgres) for every route, including RBAC
  denial and validation errors; unit tests for pure logic; web tests for key components.
- Feature flags: when a third-party key is missing, the UI shows a clear "Not connected" state
  that links to Integrations. It never crashes and never fakes success.

## PRODUCTS
Screens: Products (239:888), Product kit (239:1081), Integrations (242:1642).
- Products list with kit completeness (n of 10 fields filled), owner, status, this-month stats
  (pieces count from briefs, installs from metric snapshots). "Add product" dialog: name, slug,
  repo URL, owner, backup, colour.
- Product kit: view and edit promise, three true behaviours (text + spec ref), never-say list
  (chips, add/remove), not built yet list, audiences, activation event, truth sources, owner
  and backup. "Sign kit" (owner only) sets signed_by, signed_at, bumps version. Editing a
  signed kit makes it unsigned (draft) until re-signed. "Refresh from repo": job `kit.refresh`
  reads the repo's `docs/specs` via GitHub API (GITHUB_TOKEN) and flags spec files that changed
  since the last sign; without a token, show "GitHub not connected".
- Integrations: list channel accounts with status and allowed actions (connect buttons call the
  PUBLISH module endpoints: `GET /integrations/oauth/:platform/start` returns `{url}`; the
  PUBLISH agent builds those; you only render the button and call it). Also the non-social
  integrations from the Figma as status rows driven by env feature flags (Claude, GitHub, R2
  storage, GA4 "check first", HubSpot "not set up"). Team and roles: list users with role,
  product memberships, backup-for; admin can invite (create user with temp password shown
  once), change role, set product membership and backup.
- Contract endpoints: GET/POST /products, GET/PATCH /products/:id, GET/PUT /products/:id/kit,
  POST /products/:id/kit/sign, POST /products/:id/kit/refresh, GET /integrations/status,
  GET/POST /users, PATCH /users/:id, PUT /products/:id/members.

## IDEAS
Screens: Ideas (240:847), Plan (240:1053).
- Ideas board: columns NEW FROM CLAUDE, STARRED, BRIEFED, PARKED with counts; mode filter chips
  (All, M1..M7); card shows title, mode, fit score, brief code if briefed, park reason. Star,
  park (with reason), unpark, delete (editor+). "Open as brief" creates a brief via MAKE's
  service function `createBriefFromIdea` exported from
  `apps/api/src/modules/make/shared.ts` (stub pre-created by the lead with the final signature,
  MAKE implements it; you only import and call it). Manual "New idea" dialog.
- Generate with Claude panel: product, mode, channels, how many (1 to 20). Prompt includes
  product kit, never-say list, last week's value scores by mode, occasions next 6 weeks, titles
  already used. Claude returns JSON ideas with fit score 0 to 100 and a one-line why. Results
  pass the never-say lint: import `lintText` from `apps/api/src/lib/claim-lint.ts` (lead-owned,
  already exists before phase 2). Ideas with a red flag are dropped or rewritten.
  The weekly run is owned by SETTINGS (see below); IDEAS exports the pure generation and
  review functions it calls: implement `generateIdeas(productId, opts, actor)` and
  `reviewIdeas(productId)` in the pre-created stub `apps/api/src/modules/ideas/shared.ts`
  (keep signatures). Build the Claude prompt context with `buildProductContext(productId)` from
  `apps/api/src/modules/settings/shared.ts` (stub pre-created, SETTINGS implements).
- Plan: month calendar (Mon start) for selected product, items placed on days with mode chip,
  drag and drop items between days (dnd-kit), add item from starred ideas, occasions shown on
  their day, "Mix check" panel (counts per mode), "Occasions this month", "Things to fix"
  warnings computed server side (founder film with no shoot slot = M1 item without a
  `shoot_at`; a product with nothing planned in a week). Freeze month (editor or owner): locks
  edits, creates briefs for each item that has no brief. Unfreeze is admin only and logged.
- Endpoints: GET/POST /ideas, PATCH /ideas/:id, POST /ideas/:id/star, /park, /unpark,
  POST /ideas/generate, GET /plans?productId&month, POST /plans, POST /plans/:id/items,
  PATCH/DELETE /plan-items/:id, POST /plans/:id/freeze, POST /plans/:id/unfreeze,
  GET /plans/:id/checks, GET /occasions?from&to, POST /occasions.

## MAKE
Screens: Briefs list (no frame: table in house style, placeholder), Brief (240:1314),
Studio (241:990).
- Brief: stage tracker (IDEA..LIVE), hook, beats (add/remove/reorder), ask, ratios, caption
  languages, channels, approvers (from product owner + brand approver), owner. Autosave
  (debounced PATCH with version check: 409 on stale version). Claim check panel runs as you
  type (debounced POST /briefs/:id/claim-check): never-say words (red, blocking), behaviour
  claims without a spec ref (amber), call-to-person rule from kit, ends on brand line. Pure
  function `runClaimCheck(brief, kit)` in `apps/api/src/modules/make/claim-check.ts`, built on
  the lead-owned `lintText` in `apps/api/src/lib/claim-lint.ts`, unit tested heavily.
  Implement `createBriefFromIdea` in the pre-created stub `apps/api/src/modules/make/shared.ts`
  (keep the signature). Claude co-writer: POST
  /briefs/:id/assist {kind: tamil_caption | alt_hooks | broll} returns suggestions to accept
  or dismiss. Freeze (blocked when red flags exist) moves to frozen.
- Studio: tabs Reel, Posters, Captions, Cut-downs. Upload master and cut-downs per ratio
  directly to storage: POST /assets/uploads (create, returns presigned single PUT for < 50 MB or
  multipart uploadId + part URLs), POST /assets/:id/complete, POST /assets/:id/abort, progress
  bar, resume not required. Video preview player with ratio switch, timecode display. Scene
  timeline (video, voice, captions, music lanes) from the brief beats (read only view).
  Render jobs list: hand-off records with status (queued, running %, done, failed) that a maker
  updates by hand or by uploading the result; job `asset.probe` reads object size and type.
  Hand-off cards (Figma, CapCut, Adobe Express, Reel studio) open configurable URLs. "Send for
  review" (needs a ready master asset) moves stage made, then GATES takes over.
- Endpoints: GET/POST /briefs, GET/PATCH /briefs/:id, POST /briefs/:id/freeze,
  POST /briefs/:id/claim-check, POST /briefs/:id/assist, POST /briefs/:id/send-for-review,
  GET /briefs/:id/assets, POST /assets/uploads, POST /assets/:id/complete,
  POST /assets/:id/abort, GET /assets/:id/url (presigned GET), DELETE /assets/:id,
  GET/POST /briefs/:id/render-jobs, PATCH /render-jobs/:id.

## GATES
Screens: Review list and Review (241:1193), Approvals (241:1363).
- Review: video preview with timecode, checklist of 8 items (claim check passed, captions in
  safe zone, real app screens only, consent on file, music licensed, tracked link present,
  AI label set, loudness target) with auto items computed from data (claim check result,
  asset consent/licence/ai flags, tracked link on posts, loudness value on asset metadata) and
  manual ticks for the rest. Comments at timecode (click on the timeline or "comment at
  0:12"), resolve, reply. Send for approval (checklist complete) creates two approvals for the
  current version: claims gate (product owner, backup) and brand gate (brand approver), due in
  24 h; notify both. Send back to brief with a note.
- Approvals: queue of pieces waiting for the current user (owner or backup or brand), with
  waiting time; detail shows claims table (claim, source, check) from the claim check, gate
  status for both, decision area: Approve, Request changes (note required). When both gates
  approved: stage approved, create draft posts by calling
  `createDraftPostsForBrief` from `apps/api/src/modules/publish/shared.ts` (stub pre-created by
  the lead, PUBLISH implements it). Request changes: stage back to brief, version bump, other gate marked stale.
  Job `approval.escalate` every 15 min: past due and not escalated means notify backup and set
  escalated_at; no backup means it waits. Never auto-approve.
- Endpoints: GET /review/queue, GET /briefs/:id/review, PATCH /briefs/:id/review/checklist,
  GET/POST /briefs/:id/comments, PATCH /comments/:id, POST /briefs/:id/send-for-approval,
  POST /briefs/:id/send-back, GET /approvals?mine=true, GET /approvals/:id,
  POST /approvals/:id/decide {decision, note}.

## PUBLISH
Screens: Publish list and Publish (242:1131); connect flow used by Integrations.
- OAuth connect per platform: GET /integrations/oauth/:platform/start returns {url} with
  signed state (CSRF), GET /integrations/oauth/:platform/callback exchanges code, stores
  encrypted tokens, discovers accounts (Meta: Pages + linked IG business account; Google:
  YouTube channel; LinkedIn: member + organisations), redirects to web /integrations with
  result. Disconnect. Token refresh before expiry (job).
- Connectors in `apps/api/src/connectors/<platform>.ts` behind one interface:
  `publish({asset, caption, scheduledAt}) -> {externalId, liveUrl}`, `fetchMetrics(post)`,
  `capabilities`. Instagram Reels: create media container (media_type REELS, video_url
  presigned GET), poll status, media_publish. Facebook Page Reels: video_reels start, upload
  from URL, finish with publish. YouTube: resumable upload from storage stream, Shorts by
  9:16 and duration, privacy from setting. LinkedIn: Videos API initialize upload, upload
  parts, Posts API create; if app lacks approval, status needs_approval. WhatsApp: no API;
  create a reminder notification with a download link at the time. All HTTP calls through a
  small client with timeouts; responses validated with zod; errors mapped to stable codes.
  Unit tests with mocked HTTP (msw or nock), never call real platforms in tests.
- Publish screen: rows per channel (format, language, when in audience time zone, how:
  Auto via API, Needs API approval, Reminder by hand) editable; best window rule (weeks 1 to 4:
  reels 6 to 9 am or 7 to 10 pm audience local time; later from metrics); tracked UTM link
  builder (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`=brief code) shown and
  copyable; Schedule all, Post now per row. Only allowed when brief stage is approved and both
  approvals match the current version (server enforced, `GATE_NOT_ALLOWED`).
- Auto schedule: when draft posts are created and the product setting `auto_schedule` is on,
  each post takes the next free slot from `nextFreeSlots(productId, platform, from, count)` in
  `apps/api/src/modules/settings/shared.ts` (stub pre-created, SETTINGS implements). Never
  before the product `launch_date`. The user can still edit the time.
- Job `post.publish` scheduled at scheduled_at; fail safe per plan section 4; manual Retry.
  Brief becomes live when its first post publishes; scheduled while any are scheduled.
- Implement `createDraftPostsForBrief` and `sendInstagramPrivateReply` in the pre-created stub
  `apps/api/src/modules/publish/shared.ts` (keep the signatures).
- Endpoints: GET /channel-accounts, DELETE /channel-accounts/:id, GET /publish/queue,
  GET /briefs/:id/posts, PATCH /posts/:id, POST /briefs/:id/posts/schedule-all,
  POST /posts/:id/post-now, POST /posts/:id/retry, POST /posts/:id/cancel,
  GET /posts/:id/tracked-link.

## INSIGHTS
Screens: Home (239:675), Analytics (242:1302), Sales (242:1486).
- Home: greeting with first name and local date, "n things need you today"; stat tiles (reach
  7 days, saves + shares, installs (UTM), open partner leads, each with change vs last week);
  Needs you list (approvals for me, plan to freeze, comments asking for link from keyword
  rules), Going out today (posts scheduled today with channel icon and status chip), Claude
  this week (latest Monday note summary + Open ideas), Sales pipeline counts, Products list
  with pieces this week. One endpoint GET /dashboard?productId.
- Analytics: last 28 days filter (7/28/90), product filter; installs by channel (bar), reach by
  week (line), "What creates value by content mode" table (pieces, value per 1k reach,
  installs, best channel); per-post table with the ladder. Value score computed in SQL or
  service with the plan formula; unit tests on the formula. Job `metrics.nightly` calls each
  connector's fetchMetrics for published posts and stores a snapshot per day. Monday note:
  implement `writeMondayNote(productId, weekStart)` in the pre-created stub
  `apps/api/src/modules/insights/shared.ts` (one thing to do more of, one to stop, from
  numbers); SETTINGS' weekly run calls it. Show it in an "Open the Monday note" dialog.
- Home also shows "Next posts" per channel for the selected product (from scheduled posts and
  the next free slots).
- Sales: kanban NEW, QUALIFIED, TALKING, PILOT, REVIEW, WON (LOST hidden by filter) with drag
  to move (dnd-kit), product chip, source; lead detail panel (source post, who, first offer,
  owner, next step + date, activity log, log a call/note). Create lead by hand. No prices.
  Keyword rules: Instagram webhook GET (verify token) and POST /webhooks/meta (verify
  X-Hub-Signature-256 with META_APP_SECRET) for comments; keyword match creates a lead and
  queues a private reply with the tracked link (call `sendInstagramPrivateReply` from
  `apps/api/src/modules/publish/shared.ts`; when it reports not connected, store as queued). Minimum personal data on leads.
- Endpoints: GET /dashboard, GET /analytics/summary, GET /analytics/by-channel,
  GET /analytics/by-mode, GET /analytics/posts, GET /notes/latest, POST /notes/generate,
  GET/POST /leads, PATCH /leads/:id, POST /leads/:id/move, GET/POST /leads/:id/activities,
  GET/POST /keyword-rules, GET/POST /webhooks/meta, GET /notifications,
  POST /notifications/:id/read, POST /notifications/read-all.

## Notes from the DOCS agent (checked 12 Oct 2026)
- Instagram and Facebook fetch media from a public URL. R2 presigned GET works. Local MinIO
  does not; the connector must return a clear `MEDIA_NOT_PUBLIC` error when STORAGE_DRIVER is
  minio, never a silent failure.
- Instagram scopes (Instagram Login): `instagram_business_basic`,
  `instagram_business_content_publish`. Facebook Login route: `instagram_basic`,
  `instagram_content_publish`, `pages_read_engagement`, `pages_manage_posts`.
- LinkedIn: `w_member_social` without review; `w_organization_social` needs Community
  Management API approval. Use a current `LinkedIn-Version` header (configurable env
  `LINKEDIN_API_VERSION`), since old versions stop working.
- YouTube: `https://www.googleapis.com/auth/youtube.upload` plus `youtube.readonly` for metrics.
- The flow has 11 steps (Sales is the 11th); spec flags it for Jeeva.

## Notes from FOUNDATION-WEB (must match)
- Shell already calls `GET /notifications` -> `{items, total}` (INSIGHTS builds it; items need
  `id, kind, title, body, link, readAt, createdAt`) and the Approvals badge calls
  `GET /approvals?decision=pending&mine=true&limit=1` and reads `total` (GATES supports these
  query params exactly).
- Every screen starts with the `Page` template. Scope queries with `useSelectedProduct()`.
- Use atoms from `@/components/atoms|molecules|organisms|templates`; see `/kit` in dev.
- Product colour field is `color`.
- Sidebar "Studio" goes to `/studio` (no id): MAKE shows a picker of briefs ready to make there.

## SETTINGS (added 19:30 from Sundaran's request)
Screens: Settings `/settings` (no Figma frame: build in the house style, mark placeholder),
plus a Schedule calendar `/schedule` (no frame, placeholder, same style as Plan).
Settings always shows the product from `useSelectedProduct()`; switching product refetches.
Tabs (URL `?tab=`): General (name, colour, status, repo, owner, backup), Knowledge, Posting
schedule, Channels, Claude and weekly run, Approvals (SLA hours, approvers via members),
Tracking (UTM prefix, base URL, preview of a link). Owner or admin can edit; others read only.
- Knowledge: upload documents to storage (reuse MAKE's presign pattern but your own endpoints
  under `/products/:id/documents`), add URL (server fetches with timeout, size limit, SSRF guard:
  block private IP ranges), sync repo specs (GitHub API, `docs/specs/**/*.md`). Job
  `document.process`: extract text (pdf: `pdf-parse` or `unpdf`; docx: `mammoth`; md/txt as is;
  html: strip tags), cap length, estimate tokens, ask Claude for a 120 to 200 word summary
  (skip with a clear status when Claude is not connected). Pin, unpin, delete, re-process.
- `buildProductContext(productId, {maxTokens})`: kit (promise, behaviours, never-say, not
  built, audiences, activation), pinned documents full text then other summaries, newest
  first, cut to budget. Pure function parts unit tested.
- Posting schedule: launch date, timezone, slot editor per platform (weekday + time + audience
  time zone, add, remove, toggle), and a preview of the next 10 slots. `nextFreeSlots(productId,
  platform, from, count)` skips slots already taken by scheduled posts and anything before
  launch date; correct across time zones and DST (use `@date-fns/tz` or Luxon). Heavily tested.
- Channels: which connected accounts this product posts to, default languages and ratio.
- Claude and weekly run: on/off, day, time, ideas count, modes, monthly token cap (shows usage
  this month), GitHub PR on/off + repo + base branch, "Run now", and a history table of
  `weekly_runs` with status, ideas created, PR link, error.
- Weekly run job `weekly.run`: a cron every 15 minutes finds products whose local day/time has
  passed for this week with no scheduled run yet, enqueues one per product (idempotent by the
  partial unique index). The run: `generateIdeas` (IDEAS), `reviewIdeas` (IDEAS),
  `writeMondayNote` (INSIGHTS), then if PR enabled and GITHUB_TOKEN set: create branch
  `growth-weekly-<yyyy-mm-dd>`, commit `docs/growth/weekly/<yyyy-mm-dd>.md`, open the PR,
  store URL. Every step logged; failure marks the run failed with the error and notifies the
  product owner; no silent retry. Notify Jeeva and the owner when done.
- Schedule calendar: week and month view of scheduled and published posts per channel for the
  selected product, with channel icons and times in the viewer time zone and audience zone.
- Endpoints: GET/PATCH /products/:id/settings, GET/PUT /products/:id/slots,
  GET /products/:id/slots/next?platform&count, GET/PUT /products/:id/channels,
  GET/POST /products/:id/documents, POST /documents/:id/complete, PATCH/DELETE /documents/:id,
  POST /documents/:id/reprocess, POST /products/:id/documents/sync-repo,
  GET /products/:id/weekly-runs, POST /products/:id/weekly-runs (run now),
  GET /schedule?productId&from&to.
- Shared stubs you implement (pre-created by the lead, keep signatures):
  `apps/api/src/modules/settings/shared.ts`: `buildProductContext`, `nextFreeSlots`,
  `getProductSettings`.
- Settings General tab edits through PRODUCTS' `PATCH /products/:id`; approvers through
  PRODUCTS' `PUT /products/:id/members`. Do not re-create those routes; use them from the web.
- Use the `ui-ux-pro-max` skill for the two placeholder screens, in the Figma house style.
