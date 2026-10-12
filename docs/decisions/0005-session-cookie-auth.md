# ADR 0005: Session cookie auth (GATE SSO can replace it later)

Status: accepted for this build (12 Oct 2026).

## Context

- Growth Desk is an internal team app with a small team.
- Humini GATE ("Login with Humini") is the ecosystem sign-in, but it is not ready to use here yet.
- We need sign-out that works at once, and sessions we can revoke.

## Decision

- Email + password. Passwords hashed with **argon2id**.
- A **server session** row in Postgres (`sessions` table).
- The browser gets an **httpOnly cookie** `gd_session` (SameSite=Lax, Secure in production).
- Mutating requests must also send an `Origin` that matches `WEB_ORIGIN`.
- Rate limit on `/api/v1/auth/*`.
- All code reads the user only through one **session boundary** (the auth middleware puts
  the user on the request). No route checks passwords or cookies itself.

## Consequences

- No JWT in local storage. JavaScript cannot read the cookie.
- Revoke = delete the session row.
- **Humini GATE SSO can replace the password step later.** Only the sign-in step changes:
  GATE confirms the person, then we create the same `sessions` row and cookie.
  Routes, roles and the rest of the app do not change.
