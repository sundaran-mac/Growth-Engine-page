import { describe, expect, it } from 'vitest';
import { canDo } from './access.js';
import { calendarWeeks, computePlanChecks, crossProductWarnings, emptyWeeks, isDateInMonth, monthRange } from './plan-checks.js';
import { buildGeneratePrompt, clampScore, cleanText, titleKey } from './prompts.js';
import { lintIdeaText } from './generation.js';

const P = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const EM_DASH = String.fromCharCode(0x2014);

describe('plan calendar', () => {
  it('gives the month range, including leap years', () => {
    expect(monthRange('2026-11')).toEqual({ first: '2026-11-01', last: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthRange('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });

  it('builds Monday-first weeks like the Figma November plan', () => {
    const weeks = calendarWeeks('2026-11');
    expect(weeks[0]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(weeks).toHaveLength(6);
    expect(weeks.at(-1)![0]).toBe('2026-11-30');
    for (const row of weeks) expect(row).toHaveLength(7);
  });

  it('starts on the 1st when the month starts on a Monday', () => {
    expect(calendarWeeks('2027-02')[0]![0]).toBe('2027-02-01');
    expect(calendarWeeks('2027-02')).toHaveLength(4);
  });

  it('checks a date is inside the month', () => {
    expect(isDateInMonth('2026-11-30', '2026-11')).toBe(true);
    expect(isDateInMonth('2026-12-01', '2026-11')).toBe(false);
  });
});

describe('plan checks', () => {
  const item = (id: string, date: string, mode: 'M1' | 'M3' | null, needsShootSlot = false) => ({ id, date, mode, needsShootSlot });

  it('counts the mix per mode, highest first, every mode listed', () => {
    const r = computePlanChecks(
      '2026-11',
      [item('a', '2026-11-02', 'M1'), item('b', '2026-11-03', 'M1'), item('c', '2026-11-04', 'M3'), item('d', '2026-11-08', null)],
      'Humini Live',
    );
    expect(r.total).toBe(4);
    expect(r.mix).toHaveLength(7);
    expect(r.mix[0]).toEqual({ mode: 'M1', count: 2 });
    expect(r.mix[1]).toEqual({ mode: 'M3', count: 1 });
    expect(r.mix[2]).toEqual({ mode: 'M2', count: 0 });
  });

  it('warns about founder films with no shoot slot', () => {
    const r = computePlanChecks('2026-11', [item('a', '2026-11-13', 'M1', true), item('b', '2026-11-20', 'M1', true), item('c', '2026-11-21', 'M3', true)], 'Live');
    const w = r.warnings.find((x) => x.code === 'NO_SHOOT_SLOT');
    expect(w?.message).toBe('2 founder films have no shoot slot');
    expect(w?.itemIds).toEqual(['a', 'b']);
  });

  it('uses the singular for one film', () => {
    const r = computePlanChecks('2026-11', [item('a', '2026-11-13', 'M1', true)], 'Live');
    expect(r.warnings[0]?.message).toBe('1 founder film has no shoot slot');
  });

  it('warns about empty weeks, checking only weeks whose Thursday is in the month', () => {
    const items = [
      item('b', '2026-11-02', 'M1'), // week 2
      item('c', '2026-11-12', 'M3'), // week 3
      item('d', '2026-11-25', 'M3'), // week 5
      item('e', '2026-10-28', 'M3'), // outside the month: ignored
    ];
    const r = computePlanChecks('2026-11', items, 'Humini Live');
    const empty = r.warnings.filter((w) => w.code === 'EMPTY_WEEK');
    // Week 1 (26 Oct to 1 Nov) and week 6 (30 Nov to 6 Dec) belong to October and December.
    expect(empty.map((w) => w.week)).toEqual([4]);
    expect(empty[0]?.message).toBe('No Humini Live piece in week 4');
    expect(r.total).toBe(3);
  });

  it('flags every owned week of an empty month', () => {
    expect(computePlanChecks('2026-11', [], 'Live').warnings.map((w) => w.week)).toEqual([2, 3, 4, 5]);
    expect(computePlanChecks('2027-02', [], 'Live').warnings).toHaveLength(4);
  });
});

describe('cross-product plan check', () => {
  it('flags each week of the month with nothing planned for another signed product', () => {
    const w = crossProductWarnings('2026-11', [
      { productId: 'pulse', name: 'Pulse', dates: ['2026-11-03', '2026-11-18', '2026-11-26', '2026-10-28'] },
    ]);
    // Weeks 2 to 5 belong to November; week 3 (9 to 15 Nov) has nothing for Pulse.
    expect(w).toEqual([
      { code: 'PRODUCT_EMPTY_WEEK', message: 'No Pulse piece in week 3', itemIds: [], week: 3, productId: 'pulse' },
    ]);
  });

  it('gives one warning for a product with nothing this month, and none when every week has a piece', () => {
    const w = crossProductWarnings('2026-11', [
      { productId: 'send', name: 'Send', dates: ['2026-10-30'] },
      { productId: 'tick', name: 'Tick', dates: ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'] },
      { productId: 'give', name: 'Give', dates: [] },
    ]);
    expect(w.map((x) => x.message)).toEqual([
      'No Give piece planned in November',
      'No Send piece planned in November',
    ]);
    expect(w.every((x) => x.week === null)).toBe(true);
  });

  it('emptyWeeks counts only weeks whose Thursday is in the month', () => {
    expect(emptyWeeks('2026-11', new Set()).map((x) => x.week)).toEqual([2, 3, 4, 5]);
    expect(emptyWeeks('2026-11', new Set(['2026-11-01'])).map((x) => x.week)).toEqual([2, 3, 4, 5]);
  });
});

describe('access rules', () => {
  const m = (productRole: 'owner' | 'backup' | 'maker' | 'reviewer') => [{ productId: P, productRole }];

  it('lets admins do everything', () => {
    for (const a of ['read', 'write', 'delete', 'freeze', 'unfreeze'] as const) expect(canDo({ role: 'admin' }, [], P, a)).toBe(true);
  });

  it('lets editors write, delete and freeze but not unfreeze', () => {
    expect(canDo({ role: 'editor' }, [], P, 'write')).toBe(true);
    expect(canDo({ role: 'editor' }, [], P, 'delete')).toBe(true);
    expect(canDo({ role: 'editor' }, [], P, 'freeze')).toBe(true);
    expect(canDo({ role: 'editor' }, [], P, 'unfreeze')).toBe(false);
  });

  it('lets members act only on their own product, by product role', () => {
    expect(canDo({ role: 'member' }, [], P, 'read')).toBe(false);
    expect(canDo({ role: 'member' }, m('reviewer'), P, 'read')).toBe(true);
    expect(canDo({ role: 'member' }, m('reviewer'), P, 'write')).toBe(false);
    expect(canDo({ role: 'member' }, m('maker'), P, 'write')).toBe(true);
    expect(canDo({ role: 'member' }, m('maker'), OTHER, 'write')).toBe(false);
    expect(canDo({ role: 'member' }, m('maker'), P, 'freeze')).toBe(false);
    expect(canDo({ role: 'member' }, m('owner'), P, 'freeze')).toBe(true);
    expect(canDo({ role: 'member' }, m('owner'), P, 'delete')).toBe(false);
  });

  it('lets viewers read but never write', () => {
    expect(canDo({ role: 'viewer' }, [], P, 'read')).toBe(true);
    expect(canDo({ role: 'viewer' }, m('owner'), P, 'write')).toBe(true);
    expect(canDo({ role: 'viewer' }, [], P, 'write')).toBe(false);
  });
});

describe('prompt helpers', () => {
  it('cleans Claude text: one line, no long dash, trimmed', () => {
    expect(cleanText(`  Their clock ${EM_DASH} not yours\n`, 50)).toBe('Their clock, not yours');
    expect(cleanText('a'.repeat(200), 10)).toHaveLength(10);
  });

  it('clamps scores to 0..100 whole numbers', () => {
    expect(clampScore(120)).toBe(100);
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(86.6)).toBe(87);
    expect(clampScore(Number.NaN)).toBe(0);
  });

  it('compares titles without case or punctuation', () => {
    expect(titleKey('Their clock, not yours!')).toBe(titleKey('their clock not yours'));
  });

  it('builds a prompt with every input Claude must read', () => {
    const text = buildGeneratePrompt({
      productName: 'Humini Live',
      contextText: 'Promise: stay close.',
      neverSay: ['60-second call'],
      notBuilt: ['Surprise moments'],
      lastWeek: [{ mode: 'M1', pieces: 3, reach: 1200, valueScore: 41.5 }],
      occasions: [{ name: 'Deepavali', date: '2026-11-08', endDate: '2026-11-11' }],
      usedTitles: ['Their clock, not yours'],
      audiences: ['Parents abroad'],
      behaviours: ['Calls at their time'],
      coverageText: 'By mode: M1 Founder (4).',
      similarPastText: '- Grandma on video (Humini Live)',
      seedsText: '- Parents abroad x Calls at their time x M1',
      rejected: [{ title: 'Old one', reason: 'too close to "Older one"' }],
      count: 5,
      modes: ['M1'],
      channels: ['instagram'],
      today: '2026-10-12',
    });
    for (const part of ['Parents abroad', 'Calls at their time', 'By mode: M1 Founder (4).', 'Grandma on video', 'Old one: too close', 'exactly 5', 'M1 Founder', 'Instagram', 'Promise: stay close.', '60-second call', 'Surprise moments', 'value per 1k reach 41.5', 'Deepavali (2026-11-08 to 2026-11-11)', 'Their clock, not yours']) {
      expect(text).toContain(part);
    }
    expect(text).not.toContain(EM_DASH);
  });

  it('finds never-say and not-built phrases in idea text', () => {
    const kit = { neverSay: ['60-second call'], notBuilt: [{ text: 'Surprise moments (spec 012)' }] };
    expect(lintIdeaText('Try a 60 second call with grandma', kit)).toBe('60 second call');
    expect(lintIdeaText('Surprise moments for mum', kit)).toBe('Surprise moments');
    expect(lintIdeaText('Their clock, not yours', kit)).toBeNull();
  });
});
