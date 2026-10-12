/**
 * Product context for Claude prompts (pure, no database).
 * Order: kit first, then pinned documents in full (newest first), then summaries of the other
 * documents (newest first). Everything is cut to a token budget.
 */
import type { KitBehaviour, KitNotBuilt } from '@growth-desk/contract';

/** Rough token estimate: about 4 characters per token for English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const DEFAULT_CONTEXT_TOKENS = 6000;
/** A pinned document is cut (not dropped) only when at least this much budget is left. */
const MIN_PARTIAL_TOKENS = 200;

export interface KitForContext {
  promise: string | null;
  behaviours: KitBehaviour[];
  neverSay: string[];
  notBuilt: KitNotBuilt[];
  audiences: string[];
  activationEvent: string | null;
}

export interface ContextDocument {
  id: string;
  title: string;
  /** Full text for pinned documents, summary for the rest. */
  text: string;
}

export interface ContextInput {
  productName: string;
  kit: KitForContext | null;
  pinned: ContextDocument[];
  others: ContextDocument[];
}

export interface AssembledContext {
  text: string;
  tokenEstimate: number;
  documentIds: string[];
}

const ref = (specRef: string | null) => (specRef ? ` (spec ${specRef})` : '');

export function renderKit(productName: string, kit: KitForContext | null): string {
  const lines = [`# Product: ${productName}`];
  if (!kit) {
    lines.push('No product kit yet.');
    return lines.join('\n');
  }
  lines.push('## Product kit');
  if (kit.promise) lines.push(`Promise: ${kit.promise}`);
  if (kit.behaviours.length > 0) {
    lines.push('True behaviours:');
    for (const b of kit.behaviours) lines.push(`- ${b.text}${ref(b.specRef)}`);
  }
  if (kit.neverSay.length > 0) lines.push(`Never say: ${kit.neverSay.join(', ')}`);
  if (kit.notBuilt.length > 0) {
    lines.push('Not built yet (never claim these):');
    for (const n of kit.notBuilt) lines.push(`- ${n.text}${ref(n.specRef)}`);
  }
  if (kit.audiences.length > 0) lines.push(`Audiences: ${kit.audiences.join(', ')}`);
  if (kit.activationEvent) lines.push(`Activation event: ${kit.activationEvent}`);
  return lines.join('\n');
}

/** Cuts text to about `tokens` tokens, on a word boundary when one is near. */
export function cutToTokens(text: string, tokens: number): string {
  const maxChars = Math.max(0, tokens * 4);
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const space = slice.lastIndexOf(' ');
  return `${space > maxChars * 0.8 ? slice.slice(0, space) : slice} [cut]`;
}

export function assembleContext(
  input: ContextInput,
  maxTokens = DEFAULT_CONTEXT_TOKENS,
): AssembledContext {
  const budget = Math.max(1, maxTokens);
  const parts: string[] = [];
  const documentIds: string[] = [];
  let used = 0;

  const kitText = renderKit(input.productName, input.kit);
  const kitPart = estimateTokens(kitText) > budget ? cutToTokens(kitText, budget) : kitText;
  parts.push(kitPart);
  used += estimateTokens(kitPart);

  const add = (block: string, id: string): boolean => {
    const cost = estimateTokens(block) + 1;
    if (used + cost > budget) return false;
    parts.push(block);
    used += cost;
    documentIds.push(id);
    return true;
  };

  let pinnedHeaderAdded = false;
  for (const doc of input.pinned) {
    if (!pinnedHeaderAdded) {
      const header = '## Pinned documents';
      if (used + estimateTokens(header) + 1 > budget) break;
      parts.push(header);
      used += estimateTokens(header) + 1;
      pinnedHeaderAdded = true;
    }
    const block = `### ${doc.title}\n${doc.text}`;
    if (add(block, doc.id)) continue;
    const left = budget - used - estimateTokens(`### ${doc.title}\n`) - 2;
    if (left >= MIN_PARTIAL_TOKENS) add(`### ${doc.title}\n${cutToTokens(doc.text, left)}`, doc.id);
    break;
  }

  let summaryHeaderAdded = false;
  for (const doc of input.others) {
    if (!doc.text.trim()) continue;
    if (!summaryHeaderAdded) {
      const header = '## Other documents (summaries)';
      if (used + estimateTokens(header) + 1 > budget) break;
      parts.push(header);
      used += estimateTokens(header) + 1;
      summaryHeaderAdded = true;
    }
    // Skip one that does not fit; a shorter, older summary may still fit.
    add(`- ${doc.title}: ${doc.text}`, doc.id);
  }

  const text = parts.join('\n\n');
  return { text, tokenEstimate: estimateTokens(text), documentIds };
}
