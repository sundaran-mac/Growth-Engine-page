# Spec 001: Growth Desk

Status: draft for review. Date: 12 Oct 2026. Owner: Sundaran V.
Brainstorm: `docs/brainstorms/001-growth-desk.md`.
Sources: `docs/reference/figma-functional-doc.md` (Jeeva, 12 Oct 2026) and
`docs/plan/BUILD-PLAN.md`. UI: Figma file `sUxvEcixtr0XhtgLdNhWZU`, page `237:673`.

## 1. Purpose

Growth Desk is one web app to plan, make, approve, publish, measure and sell,
for every Humini product. The first product is Humini LIVE.

Three rules shape everything:

1. **Claude drafts. People decide. Tools do the repeating.**
2. **Nothing goes public without both human gates** (claims and brand) for that exact version.
3. **Every number ends in the product's activation event or a signed partner.**

## 2. Users and roles

### 2.1 Who uses it

The product team does marketing and sales too: product owners, designers,
developers, testers, plus Jeeva, Tamil, Sundaran, Elan and a community owner.

### 2.2 RACI by stage (from doc section 03)

D = does the work. A = approves. C = checks or is consulted. Blank = no role.
The two A columns are the gates: nothing goes public without both.

| Who | Kit | Ideas | Plan | Brief | Studio | Review | Approve | Publish | Engage | Analytics | Sales |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Product owner (one per product) | A | C | C | C | | C | A | | | C | C |
| Elan (founder, brand) | C | C | A | | D | | A | | | C | D |
| Jeeva (runs the engine) | D | D | D | D | D | D | | D | | D | C |
| Designers (Figma, posters) | | C | | C | D | C | | | | | |
| Tamil, Sundaran (video and motion) | | C | | C | D | C | | | | | |
| Developers (integrations, Inside Arus) | C | | | | C | | | C | | C | |
| Testers (checklist, links, captions) | | | | | | D | | C | | | |
| Community owner (replies and leads, to name) | | | | | | | | | D | | D |
| Claude (drafts only) | D | D | C | D | D | C | | | D | D | |

Note: the cells were read from the Figma layout positions (frame `246:1233`),
because the text extract lost the columns.

### 2.3 Roles in the app

| Role kind | Values | Meaning |
|---|---|---|
| Global `role` | `admin`, `editor`, `member`, `viewer` | What a user can do across the app |
| Per product `product_role` | `owner`, `backup`, `maker`, `reviewer` | What a user does for one product |
| Flag `is_brand_approver` | true or false | Can decide the brand gate (Elan today) |

## 3. The stages and the 2 gates

The doc says "ten stages, product to sales". Its flow picture shows 11 numbered
boxes, and the RACI table has 11 columns. The 11 boxes are listed below.
Open point: confirm with Jeeva which count is right.

| # | Stage | What happens | Lane |
|---|---|---|---|
| 01 | Product kit | Repo becomes the truth | Made with Claude's help |
| 02 | Ideas | Claude drafts, you star | Made with Claude's help |
| 03 | Plan | Month frozen | Team |
| 04 | Brief | Script + claim check | Made with Claude's help |
| 05 | Studio | Posters, reels, captions | Made with Claude's help |
| 06 | Review | Team checklist | Team check |
| 07 | Approve | Owner + Elan | **Human gate** |
| 08 | Publish | Right time, every channel | Runs on its own once approved |
| 09 | Engage | Replies become leads | Runs on its own once approved |
| 10 | Analytics | What worked | Runs on its own once approved |
| 11 | Sales | Pilot to won | Team |

Every Monday, the learning note feeds new ideas (back to stage 02).

### 3.1 The two gates

| Gate | Who decides | Question |
|---|---|---|
| `claims` | The product owner (backup if away) | Is every claim true, with a spec behind it? |
| `brand` | Elan (`is_brand_approver`) | Is it on-brand? |

### 3.2 Brief stage machine

`idea -> brief -> frozen -> made -> reviewed -> approved -> scheduled -> live`

| Move | Rule |
|---|---|
| brief -> frozen | Blocked while the claim check has a red flag |
| made -> reviewed | Checklist complete ("Send for approval" needs it) |
| reviewed -> approved | Both gates approved for the current version |
| any gate "request changes" | Back to `brief` with the note; version goes up by 1; old approvals become stale |
| approved -> scheduled | Draft posts are created; the user schedules them |
| scheduled -> live | The first post publishes |
| publish fails | Brief goes back to `scheduled` (see section 9) |

## 4. The 13 screens

Common to all screens: sidebar with sections MAKE, SHIP, LEARN; product switcher
("Humini ecosystem", product name); global search; signed-in user at the bottom.
Plus a Sign in screen at `/login` (no Figma frame; placeholder in house style).

### 00 Home (frame `239:675`, route `/`)

- **Purpose:** the day at a glance.
- **What you do:** see what needs you (approvals, the plan to freeze, comments asking
  for a link); see what goes out today, on which channel, at what time; jump to
  Claude's new ideas and the pipeline.
- **Runs on its own:** counts and the queue update on their own.
- **Acceptance:**
  - [ ] "Needs you" lists my pending approvals, plans to freeze and keyword comments, with waiting time
  - [ ] "Going out today" lists today's posts with time (audience zone), channel and auto or by hand
  - [ ] "Claude this week" shows the latest weekly summary
  - [ ] Sales pipeline shows counts for New, Talking, Pilot, Won
  - [ ] Products list shows pieces this week per product
  - [ ] Each item links to its screen

### 01 Products (frame `239:888`, route `/products`)

- **Purpose:** every Humini product in one list.
- **What you do:** add a product by pointing at its repo; see how complete each kit is
  and who owns it; open a product kit.
- **Runs on its own:** Claude reads the repo and drafts the kit; the owner signs it.
- **Acceptance:**
  - [ ] Card per product: name, status, promise, kit score (x/10), signed date, owner, this month pieces and installs
  - [ ] "Owner to confirm" shows when no owner is set
  - [ ] "Add the next product" takes a repo and creates a draft kit
  - [ ] Card opens the product kit

### 02 Product kit (frame `239:1081`, route `/products/:productId/kit`)

- **Purpose:** the truth every post starts from.
- **What you do:** edit promise, three true behaviours with their specs, who it is for;
  never-say words and what is not built yet; owner and backup, truth sources,
  activation event; sign the kit.
- **Runs on its own:** "Refresh from repo" re-reads the specs and flags what changed.
- **Acceptance:**
  - [ ] Every behaviour has a spec reference
  - [ ] Never-say list and "not built yet" list are editable
  - [ ] Only the product owner can sign; signing stores who, when and the kit version
  - [ ] Any edit after signing makes a new version that needs a new signature
  - [ ] Refresh from repo shows a list of changed items; nothing changes without a person

### 03 Ideas (frame `240:847`, route `/ideas`)

- **Purpose:** a board of ideas, drafted by Claude.
- **What you do:** generate ideas for a product, mode and channel; star the ones to make;
  park the rest; open a starred idea as a brief.
- **Runs on its own:** a weekly run adds new ideas every Monday from the kit and last week's numbers.
- **Acceptance:**
  - [ ] Columns: New from Claude, Starred, Briefed, Parked, with counts
  - [ ] Filter by mode (M1 Founder, M2 AI people, M3 Motion, M4 Posters, M5 Fun, M6 Inside Arus, M7 Ecosystem)
  - [ ] Each card shows title, mode, fit score; briefed cards show the brief code
  - [ ] "Generate with Claude" takes product, mode, channels, how many
  - [ ] Claude reads: the kit, the never-say list, last week's value scores, occasions, ideas already used
  - [ ] Generate is refused with a clear message when the monthly Claude cap is reached

### 04 Plan (frame `240:1053`, route `/plan`)

- **Purpose:** the month, on a calendar.
- **What you do:** drag pieces to days and channels; check the mix of modes and the
  occasions; freeze the month, which locks it for briefs.
- **Runs on its own:** warnings for gaps (no shoot slot, a product with nothing planned).
- **Acceptance:**
  - [ ] Month calendar, Monday first, with pieces and occasions on days
  - [ ] Mix check counts pieces per mode
  - [ ] Occasions this month are listed
  - [ ] Warnings list the things to fix
  - [ ] Freeze sets the plan to `frozen`; a frozen plan cannot be dragged

### 05 Brief (frame `240:1314`, routes `/briefs`, `/briefs/:briefId`)

- **Purpose:** one piece, fully written down.
- **What you do:** hook, beats and ask; ratios, captions, channels, approvers;
  accept Claude's caption, hooks and B-roll list; freeze the brief when it is right.
- **Runs on its own:** the claim check runs as you type and blocks never-say words.
- **Acceptance:**
  - [ ] Stage bar shows the 8 brief stages and the current one
  - [ ] Fields: hook, beats, ask, ratios, caption languages, channels, approvers
  - [ ] Claim check shows each rule as pass or red flag, with a suggestion
  - [ ] Freeze is disabled while any red flag is open
  - [ ] Claude co-writer suggestions can be accepted one by one; nothing is applied without a click
  - [ ] Brief has a human code (for example `REEL-031`) and a version number

### 06 Studio (frame `241:990`, route `/studio/:briefId`)

- **Purpose:** where it gets made.
- **What you do:** see the scene timeline (video, voice, captions, music); hand off to
  Figma, CapCut, Adobe Express or the reel studio; track render jobs and cut-downs.
- **Runs on its own:** renders, voice, mix and cut-downs run as jobs; results come back here.
- **Acceptance:**
  - [ ] Tabs: Reel, Posters, Captions, Cut-downs
  - [ ] Preview with ratio switch (9:16, 4:5, 1:1)
  - [ ] Upload a finished file straight to storage (large video uses multipart upload)
  - [ ] Each asset stores kind, ratio, licence, consent and AI-generated flag
  - [ ] Render jobs list shows status and progress
  - [ ] Hand-off links open the outside tool

### 07 Review (frame `241:1193`, routes `/review`, `/review/:briefId`)

- **Purpose:** the team checks it.
- **What you do:** watch the preview, tick the checklist; comment at a timecode;
  send for approval, or back to the brief.
- **Runs on its own:** loudness, safe zone, link and AI-label checks fill in automatically.
- **Acceptance:**
  - [ ] Checklist with count (for example "7 of 8") per brief version
  - [ ] Auto checks are marked as auto and cannot be ticked by hand
  - [ ] Comments carry author, timecode and body; can be resolved
  - [ ] "Send for approval" is disabled until the checklist is complete

### 08 Approvals (frame `241:1363`, route `/approvals`)

- **Purpose:** the two human gates.
- **What you do:** product owner checks each claim against its spec; Elan gives brand
  approval; approve, or request changes with a note.
- **Runs on its own:** no answer in 24 h goes to the backup; every decision is logged.
- **Acceptance:**
  - [ ] Queue shows piece, product, gate(s), waiting time
  - [ ] Claims table: claim, source (spec or kit), check result
  - [ ] Each gate shows its state (pending, approved, changes requested)
  - [ ] Only the named approver (or backup after escalation) can decide
  - [ ] Request changes needs a note
  - [ ] Every decision stores who, when, which version, and the note

### 09 Publish (frame `242:1131`, routes `/publish`, `/publish/:briefId`)

- **Purpose:** right place, right time.
- **What you do:** one approved master fans out to every channel, each in its ratio,
  language and audience time; schedule all, or post now.
- **Runs on its own:** posting runs through each platform's API where allowed;
  WhatsApp becomes a reminder.
- **Acceptance:**
  - [ ] Only briefs with both gates approved for the current version can be scheduled
  - [ ] Row per channel: channel, format, language, when (audience time), how (auto, needs approval, by hand)
  - [ ] Best window rule shown (see section 8.3)
  - [ ] A tracked link (UTM) is made per post and shown
  - [ ] A failed post shows the error and a manual retry button

### 10 Analytics (frame `242:1302`, route `/analytics`)

- **Purpose:** what worked, and why.
- **What you do:** reach, saves and shares, clicks, installs, activations; installs by
  channel; value by content mode; open the Monday note.
- **Runs on its own:** numbers are pulled nightly; Claude writes the Monday note.
- **Acceptance:**
  - [ ] Installs by channel chart
  - [ ] Reach by week chart
  - [ ] Value by content mode table: mode, pieces, value per 1K reach, installs, best channel
  - [ ] Sample data is labelled "sample data"

### 11 Sales (frame `242:1486`, route `/sales`)

- **Purpose:** from comment to signed partner.
- **What you do:** a pipeline for every product; each lead shows the post it came from;
  move a lead, log a call, set the next step.
- **Runs on its own:** keyword replies and tracked links create leads on their own.
- **Acceptance:**
  - [ ] Board by stage, filter by product
  - [ ] Lead detail: source, who, first offer, owner, next step and date
  - [ ] Moving a lead or logging a call writes a lead activity
  - [ ] No price or money field anywhere

### 12 Integrations (frame `242:1642`, route `/integrations`)

- **Purpose:** what it connects to, and who can do what.
- **What you do:** connect Instagram, Facebook, YouTube, LinkedIn, WhatsApp; connect
  Claude, GitHub, Drive, analytics and CRM; set roles and backups.
- **Runs on its own:** each connection shows its status and what it is allowed to do.
- **Acceptance:**
  - [ ] Card per integration with status: connected, needs approval, manual, hand-off, check first, not set up
  - [ ] Connect starts the platform OAuth flow; tokens never reach the browser
  - [ ] Disconnect removes the tokens and writes the audit log
  - [ ] Team list shows each person's role and backup; admins can change them

## 5. Data model

### 5.1 The 13 records (doc section 07)

| # | Record | Key fields (doc) | Table(s) in the build |
|---|---|---|---|
| 1 | Product | name, owner, backup, colour | `products` |
| 2 | Product kit | promise, behaviours + spec, never-say, not built, activation | `product_kits` |
| 3 | Occasion | date, name, which products | `occasions` |
| 4 | Idea | title, mode, channel, fit score, status | `ideas` |
| 5 | Brief | hook, beats, ask, captions EN/TA, ratios, version | `briefs` (+ `plans`, `plan_items`) |
| 6 | Asset | poster or reel, ratio, file, render status | `assets`, `render_jobs` |
| 7 | Review | checklist, comments at timecodes, reviewer | `review_checklists`, `review_comments` |
| 8 | Approval | gate (claims or brand), approver, decision, note, version | `approvals` |
| 9 | Post | channel, time, audience zone, live link, tracked link | `posts` |
| 10 | Metric snapshot | date, reach, saves, shares, clicks, installs, activations, value | `metric_snapshots` |
| 11 | Person | name, role per product, backup for | `users`, `product_members` |
| 12 | Lead | organisation, product, source post, owner, stage, next step | `leads`, `lead_activities` |
| 13 | Channel account | platform, connection status, allowed actions | `channel_accounts` |

System tables: `sessions`, `audit_logs`, `notifications`, `claude_usage`,
`keyword_rules`, and the pg-boss schema. Full field lists: `BUILD-PLAN.md` section 5.

### 5.2 Links

The chain: every install traces back to one product, one idea and one approved piece.

| From | To | Kind |
|---|---|---|
| Product | Product kit | one product has one current kit (old versions kept) |
| Product | Idea, Brief, Lead, Person (membership) | one to many |
| Occasion | Product | many to many (which products) |
| Idea | Brief | one idea becomes at most one brief |
| Brief | Asset, Review checklist, Review comment, Approval | one to many |
| Brief (approved) | Post | one to many (one per channel and language) |
| Post | Metric snapshot | one to many (one per day) |
| Post | Lead (source post) | one to many |
| Channel account | Post | one to many |
| Person | Approval | approves (as approver or backup) |

## 6. Automation map (doc section 05)

| # | Trigger | Claude does | System does | A person decides |
|---|---|---|---|---|
| 01 | Every Monday, 07:00 | Ideas for each product, and the Monday note from last week's numbers | Posts ideas to the board; notifies Jeeva | Star the ideas to make |
| 02 | An idea is starred | Drafts the brief: hook, beats, ask, captions in English and Tamil, B-roll | Creates the brief, links it to the product kit | Jeeva edits the brief |
| 03 | The brief changes | Checks every line against the kit and never-say list | Blocks "freeze" while a red flag is open | Fix the flag, then freeze |
| 04 | A brief is frozen | Writes the scene file and poster copy | Runs render, voice, mix and cut-down jobs; opens hand-offs | Makers finish in Figma or CapCut |
| 05 | Sent for review | Pre-fills the checklist | Checks loudness, safe zone, link, AI label | Team ticks and comments |
| 06 | Sent for approval | - | Notifies the owner and Elan; starts a 24 h timer; escalates to the backup | Owner and Elan approve |
| 07 | Approved | - | Copies the master to the library; schedules each channel at audience time; writes tracked links | - |
| 08 | Publish time | - | Posts through each platform's API; sends a WhatsApp reminder with the file | Post to WhatsApp by hand |
| 09 | A comment with the keyword | Drafts answers to real questions | Sends the tracked link by DM; creates a lead | Community owner replies |
| 10 | Every night | Flags posts that beat or miss their mode's average | Pulls metrics from every channel; computes the value score | - |

A job queue runs the timed work and reacts to events. Every job is logged and can be retried.
Job names: see `BUILD-PLAN.md` section 7.

## 7. Channels

"Check first" marks a fact about another company's product. Confirm it in the
vendor's current docs before building on it. Setup steps and what was checked:
`docs/runbooks/social-platform-setup.md`.

| Channel | What we post | How it publishes | What comes back | Check first |
|---|---|---|---|---|
| Instagram | Reels, posts, carousels, Stories | Graph API publishing for a Business or Creator account | Reach, saves, shares, comments, profile visits | Which formats the API can publish; daily limits; platform music is added in the app, not by API |
| Facebook | Reels and Page posts | Pages API, same Meta app as Instagram | Reach, engagement, comments | Groups cannot be posted to automatically |
| YouTube | Shorts and long videos | YouTube Data API upload | Views, watch time, subscribers | Daily API quota; uploads from an unaudited app may be private until approved |
| LinkedIn | Elan's posts, company page | Posts API, needs LinkedIn to approve our app | Impressions, reactions, clicks | Approval process and which scopes cover a company page |
| WhatsApp | Channel posts, Status kits, opt-in messages | No automation route for Channels: reminder plus file. Opt-in messages via the Business Platform | Channel followers; delivery for opt-in sends | Consent rules, template approval, per-message charges |
| Later: X, Threads, Pinterest | Same pattern | One connector each | Per platform | Added only when a product's plan asks for it |

Channel account status values: `connected`, `needs_approval`, `manual`, `disconnected`, `error`.

## 8. Approval and publishing rules

### 8.1 Approval rules

- Two gates per brief version: `claims` and `brand`. Both must be `approved`.
- Claude never approves. Every gate is a named person.
- **24 h backup:** no answer in 24 h, the named backup can decide. The backup is notified.
- **No backup means the piece waits.** It never goes out unapproved.
- **Approvals never expire into "approved".** A timer can only escalate, never approve.
- **Every decision is logged:** who, when, which version, decision, note.
- Request changes sends the brief back to `brief` with the note. The version goes up.
  Approvals for the old version become stale and do not count.

### 8.2 Fail-safe publishing

If a post fails:

1. Nothing retries silently.
2. The post goes to `failed` with the error text.
3. The brief goes back to `scheduled`.
4. The owner gets a notification.
5. The channel account is marked (`error`).
6. A person presses "retry" by hand.

Other rules:

- A post is only scheduled when both gates are approved for that version.
- A channel in `needs_approval` or `manual` never auto-posts. WhatsApp is always a reminder.

### 8.3 Best windows and tracked links

- Weeks 1 to 4: starting rule. Reels 6-9 am or 7-10 pm, audience local time.
- From week 5: Growth Desk uses our own best window per channel and audience.
- Each post gets a tracked link with `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content` (brief code). Example from the doc:
  `live.humini.app/?utm_source=instagram&utm_medium=reel&utm_campaign=live-founder-oct&utm_content=REEL-031`.

## 9. Value score

Proposed in the doc. The weights are a starting point for the product team to agree
(decision 07), then tune after a month of real numbers.

```
value score = (saves*3 + shares*4 + link clicks*5 + installs*20 + activations*40) / reach * 1000
```

- It is "per 1,000 reach".
- If reach is 0, the score is not computed (shown as empty), to avoid divide by zero.
- It ranks content modes and channels by what they bring down the ladder:
  reach, saves/shares/comments, clicks, store or site visits, installs or sign-ups,
  activation event, still active in week 4, brings others in.

## 10. Privacy and security

- Follow **PDPA** (Singapore) and **DPDP** (India).
- **Minimum lead data:** organisation, who (role, not a full profile), source post,
  first offer, owner, stage, next step. No prices.
- **Role-based access** on every route (section 2.3).
- **Audit log:** every mutating action writes `audit_logs` (actor, action, entity,
  entity id, before, after). Connect and disconnect of a channel are logged.
- **Tokens:** OAuth tokens are encrypted at rest (AES-256-GCM). They never reach the web app.
- **Secrets** live in env or a vault. Never in the repo.
- **Consent and licences:** consent record per face; licence field per asset;
  AI label on by default when people are generated.
- Sample (seed) data is marked as sample and only loaded in development.

## 11. Out of scope (version 1)

- Paid ads of any kind (v2 decision).
- Rendering pixels inside the app with Claude. Renders run in our own tools; the app tracks them.
- Automatic posting to WhatsApp Channels.
- X, Threads, Pinterest connectors.
- Mobile app (desktop web first).
- Prices or money in the sales pipeline.
- Replacing Figma, CapCut or Adobe Express.

Note: the doc's "first version" also leaves out LinkedIn publishing and the sales
pipeline. This build includes the LinkedIn connector (it reports `needs_approval`
until LinkedIn approves) and the Sales screen. This is decision 02 (open).
