# ADR 0006: Claude writes words only, with a monthly cap

Status: accepted for this build (12 Oct 2026).

## Context

- Claude drafts ideas, briefs, captions, scene files, checks and notes.
- Generating at volume costs tokens. Drafts can be wrong.
- The doc says: "Claude writes words, never pixels" and "one spend cap per product per month".

## Decision

- Use `@anthropic-ai/sdk`. Model from env `ANTHROPIC_MODEL` (default `claude-opus-5-5`).
- Claude makes **text only**. Renders, voice and video run in our own tools.
- Every call is counted in `claude_usage` (product, month, tokens in and out, cap).
- The cap is `CLAUDE_MONTHLY_TOKEN_CAP` per product per month. When reached, Claude
  features for that product stop with a clear message until next month.
- If `ANTHROPIC_API_KEY` is missing in development, Claude features are off with a clear message.
- **Claude never approves.** Every Claude draft passes the claim check and a human.

## Consequences

- Cost is predictable per product.
- Claude output is a suggestion. A person accepts it with a click.
- The cap is in tokens, not money, because the tool stores no money.
