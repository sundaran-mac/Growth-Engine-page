/**
 * Claim check for a brief (pure, no I/O). Runs as the editor types and again before freeze.
 *
 * Rules, in the order the Brief screen shows them:
 * 1. never_say  (red, blocking)  kit never-say phrases, via the lead-owned `lintText`.
 * 2. not_built  (red, blocking)  features the kit lists as not built yet.
 * 3. spec_cited (amber)          a line that talks about a kit behaviour which has no spec ref.
 * 4. other      (amber)          call-to-person rule: when the product has calls, a call is never
 *                                aimed at one named person ("call your mum").
 * 5. brand_line (amber)          the piece ends on the ask and the kit promise (brand line).
 *
 * It also lists the claims for the Approvals claims table: each line that matches a kit behaviour
 * (source `spec 006`, or `kit` when the behaviour has no spec) and the ask (source `kit · ask`).
 * A claim that contains a red lint hit is a `mismatch`.
 */
import type { BriefClaim, ClaimFlag, KitBehaviour, KitNotBuilt } from '@growth-desk/contract';
import { hitsToFlags, lintText, type LintHit } from '../../lib/claim-lint.js';

export interface ClaimCheckBrief {
  hook: string | null;
  beats: readonly string[];
  ask: string | null;
}

export interface ClaimCheckKit {
  promise: string | null;
  behaviours: readonly KitBehaviour[];
  neverSay: readonly string[];
  notBuilt: readonly KitNotBuilt[];
}

export interface ClaimCheckOutput {
  flags: ClaimFlag[];
  claims: BriefClaim[];
  blocking: boolean;
}

export const PASS_MESSAGES = {
  never_say: 'No never-say words',
  not_built: 'Nothing from the not-built list',
  spec_cited: 'Every behaviour cites a spec',
  brand_line: 'Ends on the brand line',
} as const;

const STOPWORDS = new Set(
  (
    'the and for are but not you your yours with that this from have has had was were will would ' +
    'can could should into onto out over under than then them they their there these those its ' +
    'his her our ours who whom what when where which while why how all any each every some one ' +
    'two only just also very more most less much many own same such too off per via upto up to ' +
    'is be been being it of on in at as by or an a do does did doing done no nor so if am me my ' +
    'we us he she him i about after again before both down few further here once other again ' +
    'needs need needed make makes made get gets got let lets'
  ).split(/\s+/),
);

/** Lower case words, light plural stemming, stopwords removed. Numbers are kept ("60"). */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    const isNumber = /^\p{N}+$/u.test(raw);
    if (!isNumber && raw.length < 3) continue;
    out.add(stem(raw));
  }
  return out;
}

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** The thing a behaviour is about: "A byte: up to 60 seconds" gives `byte`. */
export function behaviourSubject(text: string): string | null {
  const first = text
    .replace(/^\s*(a|an|the)\s+/i, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/u)?.[0];
  return first ? stem(first) : null;
}

/** Splits a line into sentences and strips wrapping quotes. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/^["'“‘]+|["'”’]+$/g, '').trim())
    .filter((s) => s.length > 0);
}

interface Segment {
  field: 'hook' | 'beat' | 'ask';
  text: string;
}

function segmentsOf(brief: ClaimCheckBrief): Segment[] {
  const segs: Segment[] = [];
  if (brief.hook?.trim()) segs.push({ field: 'hook', text: brief.hook.trim() });
  for (const b of brief.beats) if (b.trim()) segs.push({ field: 'beat', text: b.trim() });
  if (brief.ask?.trim()) segs.push({ field: 'ask', text: brief.ask.trim() });
  return segs;
}

/** Best kit behaviour for a sentence: its subject is named, or two keywords overlap. */
export function matchBehaviour(
  sentence: string,
  behaviours: readonly KitBehaviour[],
): KitBehaviour | null {
  const words = keywords(sentence);
  let best: { b: KitBehaviour; score: number } | null = null;
  for (const b of behaviours) {
    const subject = behaviourSubject(b.text);
    const bw = keywords(b.text);
    let overlap = 0;
    for (const w of words) if (bw.has(w)) overlap += 1;
    const subjectHit = subject !== null && words.has(subject);
    if (!subjectHit && overlap < 2) continue;
    const score = (subjectHit ? 10 : 0) + overlap;
    if (!best || score > best.score) best = { b, score };
  }
  return best?.b ?? null;
}

const PERSON_WORDS =
  'amma|appa|mum|mom|mummy|mother|dad|daddy|father|grandma|grandpa|granny|paati|thatha|patti|' +
  'wife|husband|sister|brother|son|daughter|aunt|uncle|friend|boss|partner';

/** Finds "call your mum", "calling my dad", "call Amma". */
export function findCallToPerson(text: string): string[] {
  const re = new RegExp(
    `\\bcall(?:ing)?\\s+(?:(?:your|my|his|her|their|our)\\s+[\\p{L}]+|(?:${PERSON_WORDS})\\b)`,
    'giu',
  );
  return [...text.matchAll(re)].map((m) => m[0]);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupeFlags(flags: ClaimFlag[]): ClaimFlag[] {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const key = `${f.rule}|${f.status}|${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NEVER_SAY_SUGGESTION = 'Use the wording from the product kit.';
const NOT_BUILT_SUGGESTION = 'Remove it until the feature ships.';

export function runClaimCheck(brief: ClaimCheckBrief, kit: ClaimCheckKit | null): ClaimCheckOutput {
  if (!kit) {
    return {
      flags: [
        {
          rule: 'other',
          status: 'fail',
          message: 'This product has no kit yet, so no claim can be checked.',
          suggestion: 'Write and sign the product kit first.',
        },
      ],
      claims: [],
      blocking: true,
    };
  }

  const segs = segmentsOf(brief);
  const lintKit = { neverSay: kit.neverSay, notBuilt: kit.notBuilt };
  const hitsBySeg = segs.map((s) => lintText(s.text, lintKit));
  const allHits: LintHit[] = hitsBySeg.flat();

  const neverSayFlags = hitsToFlags(allHits.filter((h) => h.rule === 'never_say')).map((f) => ({
    ...f,
    suggestion: NEVER_SAY_SUGGESTION,
  }));
  const notBuiltFlags = hitsToFlags(allHits.filter((h) => h.rule === 'not_built')).map((f) => ({
    ...f,
    suggestion: NOT_BUILT_SUGGESTION,
  }));

  /* Claims and behaviours without a spec. */
  const claims: BriefClaim[] = [];
  const specFlags: ClaimFlag[] = [];
  const seenClaims = new Set<string>();
  segs.forEach((seg, i) => {
    const segHasRed = hitsBySeg[i]!.length > 0;
    if (seg.field === 'ask') {
      const text = sentences(seg.text).join(' ') || seg.text;
      if (!seenClaims.has(text)) {
        seenClaims.add(text);
        claims.push({ text, source: 'kit · ask', check: segHasRed ? 'mismatch' : 'matches' });
      }
      return;
    }
    for (const sentence of sentences(seg.text)) {
      const b = matchBehaviour(sentence, kit.behaviours);
      if (!b || seenClaims.has(sentence)) continue;
      seenClaims.add(sentence);
      const red = lintText(sentence, lintKit).length > 0;
      claims.push({
        text: sentence,
        source: b.specRef ? `spec ${b.specRef}` : 'kit',
        check: red ? 'mismatch' : b.specRef ? 'matches' : 'unchecked',
      });
      if (!b.specRef) {
        specFlags.push({
          rule: 'spec_cited',
          status: 'warn',
          message: `"${sentence}" talks about "${b.text}", which has no spec.`,
          suggestion: 'Add the spec reference in the product kit, or rewrite the line.',
        });
      }
    }
  });

  /* Call-to-person rule, only when the product has calls. */
  const callBehaviour = kit.behaviours.find((b) => behaviourSubject(b.text) === 'call') ?? null;
  const callFlags: ClaimFlag[] = [];
  if (callBehaviour) {
    for (const seg of segs) {
      for (const phrase of findCallToPerson(seg.text)) {
        const spec = callBehaviour.specRef ? ` (spec ${callBehaviour.specRef})` : '';
        callFlags.push({
          rule: 'other',
          status: 'warn',
          message: `"${capitalise(phrase)}": calls cannot be aimed at a person${spec}.`,
          suggestion: 'someone from your circles',
        });
      }
    }
  }

  /* Brand line. */
  const brandFlag: ClaimFlag = !kit.promise?.trim()
    ? {
        rule: 'brand_line',
        status: 'warn',
        message: 'The kit has no promise, so there is no brand line to end on.',
        suggestion: 'Add the promise to the product kit.',
      }
    : !brief.ask?.trim()
      ? {
          rule: 'brand_line',
          status: 'warn',
          message: 'Add an ask. The piece ends on the ask and the brand line.',
          suggestion: `Brand line: ${kit.promise.trim()}`,
        }
      : { rule: 'brand_line', status: 'pass', message: PASS_MESSAGES.brand_line, suggestion: null };

  const pass = (rule: 'never_say' | 'not_built' | 'spec_cited'): ClaimFlag => ({
    rule,
    status: 'pass',
    message: PASS_MESSAGES[rule],
    suggestion: null,
  });

  const flags = dedupeFlags([
    ...(neverSayFlags.length ? neverSayFlags : [pass('never_say')]),
    ...(notBuiltFlags.length ? notBuiltFlags : [pass('not_built')]),
    ...(specFlags.length ? specFlags : [pass('spec_cited')]),
    ...callFlags,
    brandFlag,
  ]);

  return { flags, claims, blocking: flags.some((f) => f.status === 'fail') };
}
