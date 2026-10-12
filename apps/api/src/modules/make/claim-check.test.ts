import { describe, expect, it } from 'vitest';
import {
  PASS_MESSAGES,
  behaviourSubject,
  findCallToPerson,
  keywords,
  matchBehaviour,
  runClaimCheck,
  sentences,
  type ClaimCheckBrief,
  type ClaimCheckKit,
} from './claim-check.js';

const LIVE_KIT: ClaimCheckKit = {
  promise: 'Be there for your people, in Joy and Care.',
  behaviours: [
    { text: 'A heart: the owner sees how many, never who', specRef: '006' },
    { text: 'A byte: up to 60 seconds, video or voice, replayable', specRef: '006' },
    { text: 'A call rings only when availability is on; audio first', specRef: '007' },
  ],
  neverSay: ['anonymous', 'strangers', '60-second call', 'vanishes', 'call Amma'],
  notBuilt: [{ text: 'Surprise moments (later)', specRef: '013' }],
};

const REEL_031: ClaimCheckBrief = {
  hook: '“You are not a bad friend. You are doing arithmetic.”',
  beats: [
    'A catch-up call runs 30 minutes, and it is unscheduled.',
    'Across a timezone, that window has to exist twice.',
    'Sixty seconds needs no window. That is the whole idea.',
  ],
  ask: 'Send one byte to someone you have been meaning to call.',
};

const statusOf = (flags: { rule: string; status: string }[], rule: string) =>
  flags.filter((f) => f.rule === rule).map((f) => f.status);

describe('helpers', () => {
  it('extracts keywords with plural stemming and no stopwords', () => {
    expect([...keywords('The bytes wait for your friends, 60 times')]).toEqual([
      'byte',
      'wait',
      'friend',
      '60',
      'time',
    ]);
  });
  it('finds the subject of a behaviour', () => {
    expect(behaviourSubject('A byte: up to 60 seconds')).toBe('byte');
    expect(behaviourSubject('The heart counts')).toBe('heart');
    expect(behaviourSubject('Calls ring later')).toBe('call');
    expect(behaviourSubject('   ')).toBeNull();
  });
  it('splits sentences and strips quotes', () => {
    expect(sentences('“You are not a bad friend. You are doing arithmetic.”')).toEqual([
      'You are not a bad friend.',
      'You are doing arithmetic.',
    ]);
  });
  it('matches a behaviour by subject or by two shared keywords', () => {
    expect(matchBehaviour('A byte waits for them', LIVE_KIT.behaviours)?.specRef).toBe('006');
    expect(matchBehaviour('Your owner sees how many', LIVE_KIT.behaviours)?.text).toMatch(/heart/);
    expect(matchBehaviour('You are doing arithmetic', LIVE_KIT.behaviours)).toBeNull();
  });
  it('prefers the behaviour whose subject is named', () => {
    const b = matchBehaviour('A heart for every byte of video', LIVE_KIT.behaviours);
    expect(b).not.toBeNull();
  });
  it('finds call-to-person phrases', () => {
    expect(findCallToPerson('Call your mum tonight')).toEqual(['Call your mum']);
    expect(findCallToPerson('calling my dad and call Amma')).toEqual(['calling my dad', 'call Amma']);
    expect(findCallToPerson('someone you have been meaning to call.')).toEqual([]);
    expect(findCallToPerson('a recall your team')).toEqual([]);
  });
});

describe('runClaimCheck', () => {
  it('passes REEL-031 with every rule green and lists its claims', () => {
    const out = runClaimCheck(REEL_031, LIVE_KIT);
    expect(out.blocking).toBe(false);
    expect(out.flags.map((f) => f.message)).toEqual([
      PASS_MESSAGES.never_say,
      PASS_MESSAGES.not_built,
      PASS_MESSAGES.spec_cited,
      PASS_MESSAGES.brand_line,
    ]);
    expect(out.claims).toContainEqual({
      text: 'Send one byte to someone you have been meaning to call.',
      source: 'kit · ask',
      check: 'matches',
    });
    expect(out.claims).toContainEqual({
      text: 'A catch-up call runs 30 minutes, and it is unscheduled.',
      source: 'spec 007',
      check: 'matches',
    });
    expect(out.claims.some((c) => c.text.includes('arithmetic'))).toBe(false);
  });

  it('blocks on a never-say word, any case and spacing', () => {
    const out = runClaimCheck({ ...REEL_031, hook: 'Stay ANONYMOUS, try a 60 second call' }, LIVE_KIT);
    expect(out.blocking).toBe(true);
    const red = out.flags.filter((f) => f.rule === 'never_say');
    expect(red).toHaveLength(2);
    expect(red.every((f) => f.status === 'fail' && f.suggestion)).toBe(true);
    expect(out.flags.some((f) => f.message === PASS_MESSAGES.never_say)).toBe(false);
  });

  it('blocks on a not-built feature', () => {
    const out = runClaimCheck({ ...REEL_031, beats: ['Get surprise moments from friends.'] }, LIVE_KIT);
    expect(out.blocking).toBe(true);
    expect(statusOf(out.flags, 'not_built')).toEqual(['fail']);
  });

  it('marks a claim with a red hit as mismatch', () => {
    const out = runClaimCheck(
      { hook: null, beats: ['A byte vanishes after one play.'], ask: 'Send a byte, it vanishes.' },
      LIVE_KIT,
    );
    expect(out.claims.find((c) => c.source === 'spec 006')?.check).toBe('mismatch');
    expect(out.claims.find((c) => c.source === 'kit · ask')?.check).toBe('mismatch');
  });

  it('warns (amber, not blocking) when a behaviour has no spec ref', () => {
    const kit: ClaimCheckKit = {
      ...LIVE_KIT,
      behaviours: [{ text: 'A pulse: one question a day', specRef: null }],
    };
    const out = runClaimCheck({ hook: 'One pulse a day keeps the guessing away.', beats: [], ask: 'Ask one.' }, kit);
    expect(out.blocking).toBe(false);
    expect(statusOf(out.flags, 'spec_cited')).toEqual(['warn']);
    expect(out.claims).toContainEqual(
      expect.objectContaining({ source: 'kit', check: 'unchecked' }),
    );
  });

  it('applies the call-to-person rule only when the product has calls', () => {
    const brief = { hook: 'Call your mum today.', beats: [], ask: 'Send a byte.' };
    const out = runClaimCheck(brief, LIVE_KIT);
    const call = out.flags.find((f) => f.rule === 'other');
    expect(call).toMatchObject({ status: 'warn', suggestion: 'someone from your circles' });
    expect(call?.message).toBe('"Call your mum": calls cannot be aimed at a person (spec 007).');
    expect(out.blocking).toBe(false);

    const noCalls = { ...LIVE_KIT, behaviours: LIVE_KIT.behaviours.slice(0, 2) };
    expect(runClaimCheck(brief, noCalls).flags.some((f) => f.rule === 'other')).toBe(false);
  });

  it('warns when the ask or the promise is missing', () => {
    expect(runClaimCheck({ ...REEL_031, ask: '  ' }, LIVE_KIT).flags.at(-1)).toMatchObject({
      rule: 'brand_line',
      status: 'warn',
      suggestion: 'Brand line: Be there for your people, in Joy and Care.',
    });
    expect(
      runClaimCheck(REEL_031, { ...LIVE_KIT, promise: null }).flags.at(-1),
    ).toMatchObject({ rule: 'brand_line', status: 'warn' });
  });

  it('blocks when the product has no kit', () => {
    const out = runClaimCheck(REEL_031, null);
    expect(out.blocking).toBe(true);
    expect(out.claims).toEqual([]);
  });

  it('handles an empty brief', () => {
    const out = runClaimCheck({ hook: null, beats: [], ask: null }, LIVE_KIT);
    expect(out.claims).toEqual([]);
    expect(out.blocking).toBe(false);
    expect(statusOf(out.flags, 'brand_line')).toEqual(['warn']);
  });

  it('does not repeat the same flag or claim', () => {
    const out = runClaimCheck(
      { hook: 'A byte is yours.', beats: ['A byte is yours.', 'stay anonymous', 'stay anonymous'], ask: null },
      LIVE_KIT,
    );
    expect(out.claims.filter((c) => c.text === 'A byte is yours.')).toHaveLength(1);
    expect(out.flags.filter((f) => f.rule === 'never_say')).toHaveLength(1);
  });
});
