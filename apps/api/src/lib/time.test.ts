import { describe, expect, it } from 'vitest';
import { dateKey, monthKey, weekStartKey, zonedTimeToUtc } from './time.js';

describe('time zone helpers', () => {
  it('converts audience local time to UTC', () => {
    expect(zonedTimeToUtc('2026-10-15', '19:30', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-15T14:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-10-15', '20:00', 'Asia/Singapore').toISOString()).toBe(
      '2026-10-15T12:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe(
      '2026-07-01T08:00:00.000Z',
    );
  });
  it('gives date, month and week keys in the zone', () => {
    const instant = new Date('2026-10-31T20:00:00Z'); // 1 Nov 01:30 in India
    expect(dateKey(instant, 'Asia/Kolkata')).toBe('2026-11-01');
    expect(monthKey(instant, 'Asia/Kolkata')).toBe('2026-11');
    expect(dateKey(instant, 'UTC')).toBe('2026-10-31');
    expect(weekStartKey(new Date('2026-10-15T06:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-12');
  });
});
