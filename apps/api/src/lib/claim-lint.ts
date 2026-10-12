/**
 * Never-say lint (lead-owned). A pure function shared by IDEAS and MAKE.
 * It finds kit never-say phrases and "not built yet" features inside free text.
 * Matching is case-insensitive, on word boundaries, and tolerant of extra spaces and hyphens,
 * so "60 second call" also matches the never-say entry "60-second call".
 */
import type { ClaimFlag } from '@growth-desk/contract';

export interface LintKit {
  neverSay: readonly string[];
  notBuilt: readonly { text: string }[];
}

export interface LintHit {
  rule: 'never_say' | 'not_built';
  phrase: string;
  index: number;
  match: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a forgiving pattern: spaces and hyphens between words are interchangeable. */
export function phrasePattern(phrase: string): RegExp | null {
  const words = phrase
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (words.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[\\s\\-]+')}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Short name of a not-built feature: the text before " (" or " ·", for example "Surprise moments". */
export function notBuiltName(text: string): string {
  return text.split(/\s[(·]/)[0]!.trim();
}

export function lintText(text: string, kit: LintKit): LintHit[] {
  const hits: LintHit[] = [];
  if (!text) return hits;
  const check = (rule: LintHit['rule'], phrase: string) => {
    const re = phrasePattern(phrase);
    if (!re) return;
    for (const m of text.matchAll(re)) hits.push({ rule, phrase, index: m.index ?? 0, match: m[0] });
  };
  for (const p of kit.neverSay) check('never_say', p);
  for (const nb of kit.notBuilt) check('not_built', notBuiltName(nb.text));
  return hits.sort((a, b) => a.index - b.index);
}

/** Turns lint hits into claim flags (all blocking). */
export function hitsToFlags(hits: LintHit[]): ClaimFlag[] {
  return hits.map((h) => ({
    rule: h.rule,
    status: 'fail' as const,
    message:
      h.rule === 'never_say'
        ? `"${h.match}" is on the never-say list.`
        : `"${h.match}" is not built yet. No post may show it.`,
    suggestion: null,
  }));
}
