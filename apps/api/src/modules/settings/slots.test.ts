import { describe, expect, it } from 'vitest';
import {
  earliestSlotTime,
  expandSlots,
  launchStart,
  removeTaken,
  toIsoWeekday,
  type SlotRule,
} from './slots.js';

const rule = (over: Partial<SlotRule>): SlotRule => ({
  id: 'slot-1',
  platform: 'instagram',
  weekday: 4,
  localTime: '19:30',
  audienceTimezone: 'Asia/Kolkata',
  label: null,
  ...over,
});

const iso = (d: Date) => d.toISOString();

describe('toIsoWeekday', () => {
  it('maps Sunday to 7 and keeps Monday to Saturday', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(toIsoWeekday)).toEqual([7, 1, 2, 3, 4, 5, 6]);
  });
});

describe('expandSlots across time zones', () => {
  // Monday 12 Oct 2026, 00:00 UTC.
  const from = new Date('2026-10-12T00:00:00Z');
  const to = new Date('2026-10-26T00:00:00Z');

  it('Asia/Kolkata (UTC+5:30): Thursday 19:30 is 14:00 UTC', () => {
    const out = expandSlots([rule({})], from, to);
    expect(out.map((c) => iso(c.at))).toEqual([
      '2026-10-15T14:00:00.000Z',
      '2026-10-22T14:00:00.000Z',
    ]);
    expect(out[0]).toMatchObject({
      slotId: 'slot-1',
      platform: 'instagram',
      audienceTimezone: 'Asia/Kolkata',
    });
  });

  it('Asia/Singapore (UTC+8): Thursday 20:00 is 12:00 UTC', () => {
    const out = expandSlots(
      [rule({ localTime: '20:00:00', audienceTimezone: 'Asia/Singapore' })],
      from,
      to,
    );
    expect(out.map((c) => iso(c.at))).toEqual([
      '2026-10-15T12:00:00.000Z',
      '2026-10-22T12:00:00.000Z',
    ]);
  });

  it('Asia/Dubai (UTC+4): Sunday 09:00 is 05:00 UTC', () => {
    const out = expandSlots(
      [rule({ weekday: 0, localTime: '09:00', audienceTimezone: 'Asia/Dubai' })],
      from,
      to,
    );
    expect(out.map((c) => iso(c.at))).toEqual([
      '2026-10-18T05:00:00.000Z',
      '2026-10-25T05:00:00.000Z',
    ]);
  });

  it('a local time just after midnight lands on the previous UTC day', () => {
    const out = expandSlots(
      [rule({ weekday: 1, localTime: '00:30', audienceTimezone: 'Asia/Kolkata' })],
      new Date('2026-10-11T00:00:00Z'),
      new Date('2026-10-13T00:00:00Z'),
    );
    // Monday 12 Oct 00:30 IST = Sunday 11 Oct 19:00 UTC.
    expect(out.map((c) => iso(c.at))).toEqual(['2026-10-11T19:00:00.000Z']);
  });

  it('includes `from` and excludes `to`', () => {
    const exact = new Date('2026-10-15T14:00:00Z');
    expect(expandSlots([rule({})], exact, new Date('2026-10-15T14:00:01Z'))).toHaveLength(1);
    expect(expandSlots([rule({})], new Date('2026-10-15T13:00:00Z'), exact)).toHaveLength(0);
  });

  it('sorts across rules and counts one instant once per platform', () => {
    const out = expandSlots(
      [
        rule({ id: 'b', localTime: '22:00', audienceTimezone: 'Asia/Singapore' }), // same instant as 19:30 IST
        rule({ id: 'a' }),
        rule({ id: 'c', platform: 'youtube', weekday: 2, localTime: '08:30' }),
      ],
      from,
      new Date('2026-10-19T00:00:00Z'),
    );
    expect(out.map((c) => `${c.platform} ${iso(c.at)}`)).toEqual([
      'youtube 2026-10-13T03:00:00.000Z',
      'instagram 2026-10-15T14:00:00.000Z',
    ]);
    expect(out[1]!.slotId).toBe('a');
  });

  it('returns nothing for an empty or reversed range', () => {
    expect(expandSlots([rule({})], to, from)).toEqual([]);
    expect(expandSlots([], from, to)).toEqual([]);
  });
});

describe('expandSlots across daylight saving (Europe/London)', () => {
  it('keeps the local wall-clock time when clocks go back (BST to GMT, 25 Oct 2026)', () => {
    const out = expandSlots(
      [rule({ weekday: 4, localTime: '19:00', audienceTimezone: 'Europe/London' })],
      new Date('2026-10-19T00:00:00Z'),
      new Date('2026-11-02T00:00:00Z'),
    );
    // 22 Oct: BST (UTC+1) -> 18:00 UTC. 29 Oct: GMT (UTC+0) -> 19:00 UTC.
    expect(out.map((c) => iso(c.at))).toEqual([
      '2026-10-22T18:00:00.000Z',
      '2026-10-29T19:00:00.000Z',
    ]);
  });

  it('keeps the local time when clocks go forward (GMT to BST, 28 Mar 2027)', () => {
    const out = expandSlots(
      [rule({ weekday: 1, localTime: '08:00', audienceTimezone: 'Europe/London' })],
      new Date('2027-03-21T00:00:00Z'),
      new Date('2027-04-04T00:00:00Z'),
    );
    expect(out.map((c) => iso(c.at))).toEqual([
      '2027-03-22T08:00:00.000Z',
      '2027-03-29T07:00:00.000Z',
    ]);
  });

  it('a slot inside the spring-forward gap moves to the first real time after it', () => {
    const out = expandSlots(
      [rule({ weekday: 0, localTime: '01:30', audienceTimezone: 'Europe/London' })],
      new Date('2027-03-27T00:00:00Z'),
      new Date('2027-03-29T00:00:00Z'),
    );
    // 01:30 does not exist on 28 Mar 2027; it becomes 02:30 BST = 01:30 UTC.
    expect(out).toHaveLength(1);
    expect(iso(out[0]!.at)).toBe('2027-03-28T01:30:00.000Z');
  });

  it('a slot inside the fall-back overlap takes the first (earlier) instant, once', () => {
    const out = expandSlots(
      [rule({ weekday: 0, localTime: '01:30', audienceTimezone: 'Europe/London' })],
      new Date('2026-10-24T00:00:00Z'),
      new Date('2026-10-26T00:00:00Z'),
    );
    // 01:30 happens at 00:30 UTC (BST) and 01:30 UTC (GMT); the first one is used.
    expect(out.map((c) => iso(c.at))).toEqual(['2026-10-25T00:30:00.000Z']);
  });
});

describe('removeTaken', () => {
  const slots = expandSlots(
    [rule({})],
    new Date('2026-10-12T00:00:00Z'),
    new Date('2026-10-26T00:00:00Z'),
  );

  it('drops a slot held by a post on the same platform within 30 minutes', () => {
    const out = removeTaken(slots, [
      { platform: 'instagram', at: new Date('2026-10-15T14:20:00Z') },
    ]);
    expect(out.map((c) => iso(c.at))).toEqual(['2026-10-22T14:00:00.000Z']);
  });

  it('keeps it for another platform or a post far enough away', () => {
    const out = removeTaken(slots, [
      { platform: 'youtube', at: new Date('2026-10-15T14:00:00Z') },
      { platform: 'instagram', at: new Date('2026-10-15T14:30:00Z') },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('launch date', () => {
  it('starts at midnight of the launch day in the product zone', () => {
    expect(iso(launchStart('2026-11-01', 'Asia/Kolkata')!)).toBe('2026-10-31T18:30:00.000Z');
    expect(launchStart(null, 'Asia/Kolkata')).toBeNull();
  });

  it('earliestSlotTime picks the later of from and launch', () => {
    const from = new Date('2026-10-12T00:00:00Z');
    expect(iso(earliestSlotTime(from, '2026-11-01', 'Asia/Kolkata'))).toBe(
      '2026-10-31T18:30:00.000Z',
    );
    expect(earliestSlotTime(from, '2026-09-01', 'Asia/Kolkata')).toBe(from);
    expect(earliestSlotTime(from, null, 'Asia/Kolkata')).toBe(from);
  });
});
