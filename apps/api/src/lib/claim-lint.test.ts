import { describe, expect, it } from 'vitest';
import { hitsToFlags, lintText, notBuiltName, phrasePattern } from './claim-lint.js';

const kit = {
  neverSay: ['anonymous', '60-second call', '100% private', 'call Amma'],
  notBuilt: [{ text: 'Surprise moments (spec 013, later)' }],
};

describe('lintText', () => {
  it('finds a never-say word, any case', () => {
    expect(lintText('Stay Anonymous with friends', kit).map((h) => h.phrase)).toEqual(['anonymous']);
  });
  it('treats hyphens and spaces as the same', () => {
    expect(lintText('Try a 60 second  call today', kit)).toHaveLength(1);
    expect(lintText('Try a 60-second call today', kit)).toHaveLength(1);
  });
  it('respects word boundaries', () => {
    expect(lintText('pseudonymous is fine', kit)).toHaveLength(0);
    expect(lintText('anonymously', kit)).toHaveLength(0);
  });
  it('handles symbols in phrases', () => {
    expect(lintText('It is 100% private.', kit)).toHaveLength(1);
  });
  it('flags not-built features by their short name', () => {
    const hits = lintText('Send surprise moments to your mum', kit);
    expect(hits).toEqual([expect.objectContaining({ rule: 'not_built', phrase: 'Surprise moments' })]);
  });
  it('returns hits in text order', () => {
    const hits = lintText('call Amma, stay anonymous', kit);
    expect(hits.map((h) => h.rule)).toEqual(['never_say', 'never_say']);
    expect(hits[0]!.phrase).toBe('call Amma');
  });
  it('is safe on empty input and empty phrases', () => {
    expect(lintText('', kit)).toEqual([]);
    expect(phrasePattern('   ')).toBeNull();
  });
  it('turns hits into blocking flags', () => {
    const flags = hitsToFlags(lintText('anonymous', kit));
    expect(flags[0]).toMatchObject({ rule: 'never_say', status: 'fail' });
  });
  it('extracts the short not-built name', () => {
    expect(notBuiltName('Surprise moments (spec 013, later)')).toBe('Surprise moments');
    expect(notBuiltName('Reels · later')).toBe('Reels');
  });
});
