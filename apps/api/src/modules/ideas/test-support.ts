/**
 * Test-only helpers for the IDEAS module tests (fake Claude client, fake MAKE brief creation).
 * Not imported by production code.
 */
import { eq } from 'drizzle-orm';
import type { Brief } from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { briefs, ideas } from '../../db/schema/index.js';
import type { ClaudeClient } from '../../lib/claude.js';
import type { CreateBriefFromIdeaInput } from '../make/shared.js';

let briefCounter = 100;

/** Stand-in for MAKE's createBriefFromIdea: inserts a brief and marks the idea briefed. */
export async function fakeCreateBriefFromIdea(input: CreateBriefFromIdeaInput, tx: DbOrTx = db): Promise<Brief> {
  const [idea] = await tx.select().from(ideas).where(eq(ideas.id, input.ideaId));
  if (!idea) throw new Error('idea missing');
  briefCounter += 1;
  const [row] = await tx
    .insert(briefs)
    .values({ code: `REEL-${briefCounter}`, productId: idea.productId, ideaId: idea.id, title: idea.title, mode: idea.mode, ownerId: input.actorId })
    .returning();
  await tx.update(ideas).set({ status: 'briefed' }).where(eq(ideas.id, idea.id));
  const b = row!;
  return {
    id: b.id,
    code: b.code,
    kind: b.kind,
    productId: b.productId,
    ideaId: b.ideaId,
    title: b.title,
    mode: b.mode,
    stage: b.stage,
    hook: b.hook,
    beats: b.beats,
    ask: b.ask,
    ratios: b.ratios,
    captionLanguages: b.captionLanguages,
    channels: b.channels,
    owner: null,
    claimsApprover: null,
    brandApprover: null,
    version: b.version,
    claimFlags: b.claimFlags,
    claims: b.claims,
    claudeSuggestions: b.claudeSuggestions,
    frozenAt: null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** A fake Anthropic client whose `beta.messages.parse` returns `output` as the parsed answer. */
export function fakeClaude(output: unknown, usage = { input_tokens: 120, output_tokens: 80 }) {
  const calls: { system: unknown; prompt: string }[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: { system: unknown; messages: { content: string }[] }) => {
          calls.push({ system: params.system, prompt: params.messages[0]!.content });
          return { usage, model: 'claude-test', stop_reason: 'end_turn', parsed_output: output, content: [] };
        },
      },
    },
  } as unknown as ClaudeClient;
  return { client, calls };
}
