# Growth Desk end-to-end tests

Playwright tests that drive the real app in Chromium: sign in, the shell, Products, the four
prototype flows from the functional doc (section 10), Settings, Integrations and an axe
accessibility smoke.

## Run against Docker (default)

```sh
npm run docker:up                      # builds and starts postgres, minio, api, worker, web
npm run test:e2e -w @growth-desk/e2e   # or `npm run test:e2e` once the root script exists
```

The suite targets `http://localhost:8080` (nginx serves the web app and proxies `/api`).
Before the tests start, global setup checks `/api/v1/health` and signs in once per role:

| Role key | User | Why |
|---|---|---|
| `jeeva` | jeeva@example.com | editor, maker on every product |
| `elan` | elan@example.com | admin and brand approver, named owner of Humini Live |
| `liveowner` | liveowner@example.com | product owner of Humini Live (claims gate, signs the kit) |

The cookies are saved in `e2e/.auth/<role>.json` (git-ignored).

## Run against dev servers

```sh
npm run docker:infra   # postgres and minio only
npm run dev            # api on 4000, web on 5173 (Vite proxies /api)
E2E_BASE_URL=http://localhost:5173 npm run test:e2e -w @growth-desk/e2e
```

`WEB_ORIGIN` on the API must include the web origin you test against (the default allows both
8080 and 5173), because every mutation sends that `Origin`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8080` | web app to test |
| `SEED_USER_PASSWORD` | `growthdesk-dev` | password of the seed users |
| `CI` | unset | when set: 2 retries, `test.only` is an error |

## Useful commands

```sh
npx playwright test --list            # list tests (no server needed)
npx playwright test tests/flow-a-approve-publish.spec.ts
npx playwright test --ui              # watch mode
npx playwright show-report            # HTML report in e2e/playwright-report
npm run typecheck -w @growth-desk/e2e
```

A trace is kept on the first retry, and a screenshot and video on failure (`e2e/test-results`).

## Data rules

Tests can be run again and again on the same database:

- Each flow makes its own records through the API (`support/api.ts`): a fresh idea, a fresh
  poster brief walked to "waiting for approval", tagged `E2E ...`.
- Seed records that a test changes are put back: never-say words starting with `e2e-` are
  removed and the Humini Live kit is signed again; posting slots are restored as they were.
- Flow C uses the far-future month June 2030 and unfreezes it (as admin) before each run.
- The auth rate limit allows 10 failed sign-ins per 15 minutes per IP. The wrong-password test
  uses one per run.

## Files

| Path | What |
|---|---|
| `playwright.config.ts` | chromium project, base URL, trace, screenshots, HTML report |
| `support/global-setup.ts` | health check and one sign-in per role |
| `support/env.ts` | URLs, users, password, storage state paths |
| `support/api.ts` | API client for test data (`briefWaitingForApproval` and more) |
| `support/fixtures.ts` | `pageAs(role)`, `chooseProduct`, `expectHeading`, `toast` |
| `tests/*.spec.ts` | the specs |
