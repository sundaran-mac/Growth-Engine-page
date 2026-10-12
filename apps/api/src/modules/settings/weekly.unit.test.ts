import { describe, expect, it } from 'vitest';
import type { Idea } from '@growth-desk/contract';
import type { SlotCandidate } from './slots.js';
import {
  buildProposalMarkdown,
  currentWeekStart,
  isRunDue,
  proposePlan,
  weekRunTime,
} from './weekly.js';

describe('weekRunTime and isRunDue', () => {
  it('Monday 07:00 Asia/Kolkata is Monday 01:30 UTC', () => {
    const t = weekRunTime(new Date('2026-10-14T10:00:00Z'), 'Asia/Kolkata', 1, '07:00');
    expect(t.weekStart).toBe('2026-10-12');
    expect(t.runAt.toISOString()).toBe('2026-10-12T01:30:00.000Z');
  });

  it('is not due before the time and due after it', () => {
    expect(isRunDue(new Date('2026-10-12T01:29:00Z'), 'Asia/Kolkata', 1, '07:00')).toBeNull();
    expect(
      isRunDue(new Date('2026-10-12T01:30:00Z'), 'Asia/Kolkata', 1, '07:00:00')?.weekStart,
    ).toBe('2026-10-12');
  });

  it('uses the local week: Sunday night UTC can already be Monday in Singapore', () => {
    // Sunday 11 Oct 23:30 UTC = Monday 12 Oct 07:30 SGT.
    const due = isRunDue(new Date('2026-10-11T23:30:00Z'), 'Asia/Singapore', 1, '07:00');
    expect(due?.weekStart).toBe('2026-10-12');
    expect(isRunDue(new Date('2026-10-11T23:30:00Z'), 'Asia/Kolkata', 1, '07:00')).toBeNull();
  });

  it('Sunday as run day is the last day of the ISO week', () => {
    const t = weekRunTime(new Date('2026-10-14T00:00:00Z'), 'Asia/Dubai', 0, '18:00');
    expect(t.weekStart).toBe('2026-10-12');
    expect(t.runAt.toISOString()).toBe('2026-10-18T14:00:00.000Z');
  });

  it('follows daylight saving in Europe/London', () => {
    // 26 Oct 2026 is the Monday after clocks go back: 07:00 GMT = 07:00 UTC.
    expect(
      weekRunTime(
        new Date('2026-10-27T12:00:00Z'),
        'Europe/London',
        1,
        '07:00',
      ).runAt.toISOString(),
    ).toBe('2026-10-26T07:00:00.000Z');
    // Week before (BST): 07:00 = 06:00 UTC.
    expect(
      weekRunTime(
        new Date('2026-10-20T12:00:00Z'),
        'Europe/London',
        1,
        '07:00',
      ).runAt.toISOString(),
    ).toBe('2026-10-19T06:00:00.000Z');
  });

  it('currentWeekStart is the local Monday', () => {
    expect(currentWeekStart(new Date('2026-10-18T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-19');
    expect(currentWeekStart(new Date('2026-10-18T20:00:00Z'), 'Europe/London')).toBe('2026-10-12');
  });
});

const idea = (over: Partial<Idea>): Idea => ({
  id: crypto.randomUUID(),
  productId: crypto.randomUUID(),
  title: 'Idea',
  summary: null,
  mode: 'M1',
  channels: [],
  fitScore: 50,
  status: 'new',
  source: 'claude',
  note: null,
  angle: null,
  briefId: null,
  briefCode: null,
  createdBy: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...over,
});

const slot = (platform: SlotCandidate['platform'], at: string): SlotCandidate => ({
  slotId: crypto.randomUUID(),
  platform,
  at: new Date(at),
  audienceTimezone: 'Asia/Kolkata',
  label: null,
});

describe('proposePlan', () => {
  it('gives the best idea the earliest matching slot and respects channels', () => {
    const slots = [
      slot('instagram', '2026-10-15T14:00:00Z'),
      slot('youtube', '2026-10-16T14:00:00Z'),
    ];
    const plan = proposePlan(
      [
        idea({ title: 'Low', fitScore: 40 }),
        idea({ title: 'Top', fitScore: 90, channels: ['youtube'] }),
        idea({ title: 'Mid', fitScore: 60 }),
      ],
      slots,
    );
    expect(plan.map((p) => `${p.idea.title}@${p.slot.platform}`)).toEqual([
      'Mid@instagram',
      'Top@youtube',
    ]);
  });

  it('returns nothing without slots', () => {
    expect(proposePlan([idea({})], [])).toEqual([]);
  });
});

describe('buildProposalMarkdown', () => {
  it('writes the note, the ideas table, the review and the plan', () => {
    const i = idea({
      title: 'Grandma | blessing',
      mode: 'M2',
      fitScore: 82,
      channels: ['instagram'],
    });
    const md = buildProposalMarkdown({
      productName: 'Humini Live',
      weekStart: '2026-10-12',
      timezone: 'Asia/Kolkata',
      ideas: [i],
      review: { rescored: 4, flaggedStale: 1 },
      note: {
        id: 'n',
        productId: 'p',
        weekStart: '2026-10-12',
        doMore: 'Founder films',
        stop: 'Long posters',
        summary: 'Saves went up.',
      },
      plan: [{ idea: i, slot: slot('instagram', '2026-10-15T14:00:00Z') }],
    });
    expect(md).toContain('# Growth weekly proposal: Humini Live, week of 2026-10-12');
    expect(md).toContain('- Do more of: Founder films');
    expect(md).toContain('| Grandma / blessing | M2 AI people | 82 | Instagram |');
    expect(md).toContain('- Re-scored: 4');
    expect(md).toContain('Thu 15 Oct, 19:30');
    expect(md).not.toContain(String.fromCharCode(0x2014));
  });
});
