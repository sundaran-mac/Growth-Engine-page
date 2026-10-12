# ADR 0007: Publishing connectors and fail-safe

Status: accepted for this build (12 Oct 2026).

## Context

- Four channels can publish by API (Instagram, Facebook, YouTube, LinkedIn).
  Each needs its own app, permissions and, often, a platform review.
- WhatsApp Channels has no official posting API that we found.
- A wrong or silent publish costs trust.

## Decision

- One **connector** per platform in `apps/api/src/connectors/`, with the same small interface
  (connect, refresh token, publish, fetch metrics).
- Meta (Instagram + Facebook) share one Meta app. Google (YouTube). LinkedIn. WhatsApp is reminder only.
- Each `channel_account` has a status: `connected`, `needs_approval`, `manual`, `disconnected`, `error`.
  A connector without the platform approval reports `needs_approval` and never auto-posts.
- OAuth tokens are encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`) and never sent to the web.
- **Fail-safe:** a failed publish is **not retried on its own**. The post goes to `failed`,
  the brief goes back to `scheduled`, the owner is notified, the channel account is marked.
  A person retries by hand.
- A post is only scheduled when both gates approved that brief version.

## Consequences

- Adding a channel later (X, Threads, Pinterest) is one new connector.
- Real posting is blocked until each platform approves our app.
  Setup steps: `docs/runbooks/social-platform-setup.md`.
- Some failures need a person. That is on purpose.
