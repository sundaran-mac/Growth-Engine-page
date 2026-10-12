/**
 * Time zone helpers built on Intl (no extra library). Store UTC; convert at the edges.
 */
import { env } from '../config/env.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday. */
  isoWeekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date, tz: string = env.appTimezone): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    isoWeekday: WEEKDAYS[p.weekday ?? 'Mon'] ?? 1,
  };
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** `YYYY-MM-DD` of the instant in the zone. */
export function dateKey(date: Date, tz: string = env.appTimezone): string {
  const p = zonedParts(date, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** `YYYY-MM` of the instant in the zone (Claude usage month, plan month). */
export function monthKey(date: Date, tz: string = env.appTimezone): string {
  return dateKey(date, tz).slice(0, 7);
}

/** Offset of the zone from UTC at that instant, in minutes (IST = +330). */
export function zoneOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The UTC instant for a wall-clock time in a zone.
 * Example: `zonedTimeToUtc('2026-10-15', '19:30', 'Asia/Kolkata')` is 14:00 UTC.
 */
export function zonedTimeToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes handle a zone whose offset changes near the target (daylight saving).
  let result = guess - zoneOffsetMinutes(new Date(guess), tz) * 60_000;
  result = guess - zoneOffsetMinutes(new Date(result), tz) * 60_000;
  return new Date(result);
}

/** Monday (`YYYY-MM-DD`) of the week that holds the instant, in the zone. */
export function weekStartKey(date: Date, tz: string = env.appTimezone): string {
  const p = zonedParts(date, tz);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day) - (p.isoWeekday - 1) * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/** Short label like `Thu 7:30 pm IST` for the zone. */
export function formatWhen(date: Date, tz: string): string {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
  return s.replace(/\s+/g, ' ');
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

/** ISO string or null, for DTO mapping. */
export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
