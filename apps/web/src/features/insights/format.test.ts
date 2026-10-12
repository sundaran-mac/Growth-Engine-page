import { describe, expect, it } from 'vitest';
import {
  compactNumber,
  deltaText,
  longDate,
  needsYouLine,
  productChipTone,
  timeInZone,
  toCsv,
  waitingFor,
  zoneAbbr,
} from './format';

describe('insights format', () => {
  it('shortens big numbers like the Figma tiles', () => {
    expect(compactNumber(48_200)).toBe('48.2k');
    expect(compactNumber(1930)).toBe('1,930');
    expect(compactNumber(214)).toBe('214');
    expect(compactNumber(1_250_000)).toBe('1.3M');
  });

  it('writes deltas', () => {
    expect(deltaText(12)).toBe('+12% vs last week');
    expect(deltaText(-5)).toBe('-5% vs last week');
    expect(deltaText(0)).toBe('Same as last week');
    expect(deltaText(null)).toBe('No numbers for the week before');
    expect(deltaText(31, '')).toBe('+31%');
  });

  it('shows times in the audience zone with a short name', () => {
    expect(timeInZone('2026-10-13T14:00:00.000Z', 'Asia/Kolkata')).toBe('7:30 pm IST');
    expect(timeInZone('2026-10-13T12:00:00.000Z', 'Asia/Singapore')).toBe('8:00 pm SGT');
    expect(zoneAbbr('Asia/Dubai')).toBe('GST');
  });

  it('formats dates, waits and counts', () => {
    expect(longDate('2026-10-13')).toBe('Tuesday 13 October');
    const now = new Date('2026-10-13T12:00:00Z');
    expect(waitingFor('2026-10-13T06:00:00Z', now)).toBe('waiting 6 h');
    expect(waitingFor('2026-10-13T11:35:00Z', now)).toBe('waiting 25 min');
    expect(waitingFor('2026-10-10T12:00:00Z', now)).toBe('waiting 3 d');
    expect(needsYouLine(0)).toBe('Nothing needs you today');
    expect(needsYouLine(1)).toBe('1 thing needs you today');
    expect(needsYouLine(3)).toBe('3 things need you today');
  });

  it('picks the product chip tone from its colour', () => {
    expect(productChipTone('#ff9a00')).toBe('joy');
    expect(productChipTone('#3e7568')).toBe('care');
    expect(productChipTone(null)).toBe('neutral');
  });

  it('quotes CSV cells', () => {
    expect(
      toCsv([
        ['a', 'b, "c"'],
        [1, null],
      ]),
    ).toBe('"a","b, ""c"""\n"1",""');
  });
});
