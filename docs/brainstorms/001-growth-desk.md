# Brainstorm 001: Growth Desk

Status: brainstorm, decisions still open (see the last section).
Date: 12 Oct 2026. Owner: Sundaran V.
Source: Figma functional document by Jeeva, 12 Oct 2026
(`docs/reference/figma-functional-doc.md`).

## 1. The lived experience

This is what happens today, for one product (Humini LIVE).

- Marketing work lives in six tools: Figma, a reel studio on one laptop, Drive,
  WhatsApp threads and spreadsheets (the doc's own count is "six tools").
- The knowledge also lives in three people's heads.
- Approvals happen in chat. So there is no record of who approved what.
- No post is linked to an install. So nobody knows which post works.
- Nobody can see, in one place, what is planned, what waits for approval,
  what went out, or which post brought an install.

## 2. Goals

| # | Goal | How we will know |
|---|---|---|
| G1 | One place per product holds its truth | Every post starts from a signed product kit |
| G2 | Claude drafts, people decide | Claude never approves; every gate is a named person |
| G3 | Every approval is on record | Each decision is logged with who, when and which version |
| G4 | Every post links to an install | Every post has a tracked link; metrics end in the activation event |
| G5 | Repeating work runs on its own | Publishing, replies and numbers run as jobs |
| G6 | One loop per week | The Monday note feeds the next round of ideas |

## 3. Non-goals

- **No paid ads** in version 1. Paid ads is a v2 decision.
- **Not a replacement for Figma, CapCut or Adobe Express.** Growth Desk hands work
  to them and collects the result.
- **Never posts anything unapproved.** No post is scheduled unless both gates
  approved that exact version.
- No rendering of pixels by Claude. Claude writes words only.
- No prices in the tool. The sales pipeline stores no money.
- No mobile app. Desktop web first.

## 4. Three ways to build it (from the doc, section 09)

| Option | What it is | Good | Bad |
|---|---|---|---|
| **A. Assemble existing tools** | Platform schedulers + a sheet + Drive + Claude projects + Figma. No code. | Fast to start. Nothing to maintain. | No single view. No approvals record. No link from post to install. |
| **B. Build Growth Desk in full** | The app in the doc: all modules, all connectors. | One place for everything. | Months before it is useful. Built before we know what repeats. |
| **C. Hybrid: A now, B in phases** | Run LIVE on A for six weeks. Build the core (kit, briefs, approvals, library, analytics). Switch module by module. | Useful in week 1. Each module replaces a step we already understand. | Two systems run side by side for a while. |

**The doc recommends option C.**

## 5. What this build is, and why

This build is **the app** (option B shape), built on the **core first** order.

- The build plan (`docs/plan/BUILD-PLAN.md`) builds all 13 screens as one web app.
- It follows the option C idea inside the app: the core works first, the risky
  parts switch on later.
  - Connectors that need a platform approval report `needs_approval` until it is granted.
  - WhatsApp stays a reminder plus a ready file.
  - Rendering stays a hand-off to tools (Figma, CapCut, Adobe Express, the reel studio).
- Missing third-party keys turn a feature off with a clear message. The app still runs.

Why build the app now and not wait six weeks:

- The team can still run phase 1 "by hand" (option A) at the same time.
  The app does not block that.
- The approvals record (G3) and the post-to-install link (G4) need a database.
  A sheet cannot give a reliable audit trail.

The recommendation in the doc (option C) is **not overruled here**.
It is decision 02 below, and it is still open for Elan.

## 6. Risks seen at brainstorm time

| Risk | First answer |
|---|---|
| Platform rules and approvals change | Mark each vendor fact "check first" and date it |
| WhatsApp Channels cannot be posted by API | Reminder plus file at the right time |
| A wrong claim goes public | Product kit + never-say lint + two human gates |
| Claude cost grows | Words only; one monthly cap per product |
| People have no time | Named owner per stage; 24 h rule with a backup |
| Leads are personal data | Minimum data, role-based access, audit log, PDPA and DPDP |

## 7. Open questions (the 8 decisions from doc section 10)

| # | Who decides | Question | Status |
|---|---|---|---|
| 01 | Elan | Should each product owner approve the claims about their product, beside Elan's brand approval? | open |
| 02 | Elan | Build option C: run by hand for six weeks, then build the core? | open |
| 03 | Product team | Who owns Pulse and Proof, and who backs up each approver? | open |
| 04 | Everyone | Who is the community owner for replies and leads? | open |
| 05 | Developers | Which stack and hosting, and how big is phase 2 really? | open (the build plan proposes a stack; hosting is not decided) |
| 06 | Sundaran | Which "check first" platform facts hold today? | open (first pass in `docs/runbooks/social-platform-setup.md`) |
| 07 | Product team | Do we agree the value-score weights as a starting point? | open |
| 08 | Everyone | Is "Growth Desk" the name? | open |

Next step: the spec, `docs/specs/001-growth-desk.md`.
