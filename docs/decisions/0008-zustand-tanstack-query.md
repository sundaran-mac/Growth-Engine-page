# ADR 0008: Zustand for UI state, TanStack Query for server state

Status: accepted for this build (12 Oct 2026).

## Context

- The web app has two kinds of state:
  - **server state**: data from the API (briefs, approvals, posts);
  - **UI state**: what is open, the selected product, filters, the signed-in user summary.
- Mixing them causes stale data and double sources of truth.

## Decision

- **TanStack Query v5** holds all server data: fetch, cache, retry, refetch after a change.
- **Zustand** holds only UI and session state. Never a copy of server data.
- API hooks live in `apps/web/src/features/<module>/`.

## Consequences

- After a mutation, we invalidate the matching query. The screen refreshes from the API.
- No Redux boilerplate.
- Rule for review: if a Zustand store holds a list from the API, it is a bug.
