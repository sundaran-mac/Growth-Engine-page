/**
 * Claude co-writer for a brief: Tamil caption, alternative hooks, B-roll list.
 * Claude drafts words only. Drafts that use a never-say or not-built phrase are dropped.
 * Nothing is written to the brief here; the editor accepts drafts one by one with PATCH.
 */
import { z } from 'zod';
import {
  CONTENT_MODE_LONG_LABELS,
  type AssistKind,
  type AssistResponse,
  type Language,
} from '@growth-desk/contract';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { generateJson } from '../../lib/claude.js';
import { lintText } from '../../lib/claim-lint.js';
import { buildProductContext } from '../settings/shared.js';
import { auditOf, type Actor } from './access.js';
import { loadBriefFor } from './briefs.service.js';
import { loadKit, type BriefRow } from './repo.js';

const CONTEXT_TOKENS = 4_000;

const SPECS: Record<AssistKind, { count: number; ask: string; language: Language | null }> = {
  tamil_caption: {
    count: 2,
    language: 'ta',
    ask:
      'Write 2 short social captions in Tamil (Tamil script) for this piece. Each under 220 characters. ' +
      'Same meaning as the hook and ask. Natural spoken Tamil, not a word-for-word translation.',
  },
  alt_hooks: {
    count: 3,
    language: null,
    ask:
      'Write 3 alternative hooks in English for the first 2 seconds. Each under 90 characters. ' +
      'Keep the same promise. No claims that are not in the kit.',
  },
  broll: {
    count: 8,
    language: null,
    ask:
      'List 5 to 8 B-roll shots in English that a small team can film with a phone. ' +
      'Each item 2 to 6 words, for example "phone clock" or "voice note waveform".',
  },
};

const outputSchema = z.object({ suggestions: z.array(z.string().min(1).max(400)).max(10) });

const SYSTEM =
  'You are the co-writer inside Growth Desk, the marketing desk of the Humini products. ' +
  'You draft words only. People decide. Use only facts from the product context. ' +
  'Never use a never-say phrase and never mention a feature that is not built yet. ' +
  'Answer with JSON that matches the schema.';

export function buildAssistPrompt(brief: BriefRow, kind: AssistKind, context: string): string {
  const beats = brief.beats.map((b, i) => `Beat ${i + 1}: ${b}`).join('\n');
  return [
    '<product_context>',
    context || '(no product context)',
    '</product_context>',
    '<brief>',
    `Code: ${brief.code}`,
    `Title: ${brief.title}`,
    `Mode: ${brief.mode} ${CONTENT_MODE_LONG_LABELS[brief.mode]}`,
    `Hook: ${brief.hook ?? '(empty)'}`,
    beats || 'Beats: (none)',
    `Ask: ${brief.ask ?? '(empty)'}`,
    '</brief>',
    '<task>',
    SPECS[kind].ask,
    '</task>',
  ].join('\n');
}

/** Product context, or the kit alone while SETTINGS has not implemented its shared function yet. */
async function productContext(productId: string): Promise<string> {
  try {
    return (await buildProductContext(productId, { maxTokens: CONTEXT_TOKENS })).text;
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'NOT_IMPLEMENTED') throw err;
    const kit = await loadKit(productId);
    if (!kit) return '';
    return [
      `Promise: ${kit.promise ?? ''}`,
      ...kit.behaviours.map((b) => `Behaviour: ${b.text}${b.specRef ? ` (spec ${b.specRef})` : ''}`),
      `Never say: ${kit.neverSay.join('; ')}`,
      `Not built yet: ${kit.notBuilt.map((n) => n.text).join('; ')}`,
    ].join('\n');
  }
}

export async function assistBrief(
  actor: Actor,
  briefId: string,
  kind: AssistKind,
): Promise<AssistResponse> {
  const brief = await loadBriefFor(actor, briefId, 'write');
  const spec = SPECS[kind];
  const context = await productContext(brief.productId);
  const { data } = await generateJson({
    productId: brief.productId,
    feature: `brief.assist.${kind}`,
    system: SYSTEM,
    prompt: buildAssistPrompt(brief, kind, context),
    schema: outputSchema,
    maxTokens: 2_000,
    effort: 'low',
  });
  const kit = await loadKit(brief.productId);
  const lintKit = { neverSay: kit?.neverSay ?? [], notBuilt: kit?.notBuilt ?? [] };
  const unique = [...new Set(data.suggestions.map((s) => s.trim()).filter(Boolean))];
  const passed = unique.filter((s) => lintText(s, lintKit).length === 0);
  const dropped = unique.length - passed.length;
  const clean = passed.slice(0, spec.count);
  await writeAudit({
    ...auditOf(actor),
    action: 'brief.assist',
    entity: 'brief',
    entityId: brief.id,
    after: { kind, suggestions: clean.length, dropped },
  });
  return {
    kind,
    suggestions: clean.map((text) => ({ text, language: spec.language })),
    dropped,
    generatedAt: new Date().toISOString(),
  };
}
