/**
 * Posting slot maths (pure, no database). Slots are weekly wall-clock times in the audience's
 * time zone. Luxon does the zone and daylight-saving work:
 * - a slot inside a spring-forward gap (02:30 on the day clocks jump 02:00 -> 03:00) moves
 *   forward to the first real minute after the gap (03:30 local), as Luxon does;
 * - a slot inside a fall-back overlap (01:30 happens twice) takes the first (earlier) instant.
 * Weekdays follow JavaScript `Date.getDay()`: 0 = Sunday ... 6 = Saturday.
 */
import { DateTime } from 'luxon';
import type { Platform } from '@growth-desk/contract';

export interface SlotRule {
  id: string;
  platform: Platform;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  /** `HH:mm` or `HH:mm:ss`. */
  localTime: string;
  audienceTimezone: string;
  label: string | null;
}

export interface SlotCandidate {
  slotId: string;
  platform: Platform;
  at: Date;
  audienceTimezone: string;
  label: string | null;
}

/** A post this close to a slot instant (same platform) takes the slot. */
export const SLOT_CONFLICT_WINDOW_MS = 30 * 60 * 1000;

/** JS weekday (0 = Sunday) to Luxon / ISO weekday (7 = Sunday). */
export function toIsoWeekday(jsWeekday: number): number {
  return jsWeekday === 0 ? 7 : jsWeekday;
}

function parseTime(localTime: string): { hour: number; minute: number } {
  const [h, m] = localTime.split(':').map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

/**
 * Every slot instant in `[from, to)`, sorted by time. Two slots on the same platform that land
 * on the same instant (for example 19:30 IST and 22:00 SGT) count once (the first one wins).
 */
export function expandSlots(rules: readonly SlotRule[], from: Date, to: Date): SlotCandidate[] {
  if (to.getTime() <= from.getTime()) return [];
  const out: SlotCandidate[] = [];
  for (const rule of rules) {
    const zone = rule.audienceTimezone;
    const { hour, minute } = parseTime(rule.localTime);
    const isoDay = toIsoWeekday(rule.weekday);
    // Walk local days from one day before `from` to one day after `to` (covers zone offsets).
    let day = DateTime.fromJSDate(from, { zone }).startOf('day').minus({ days: 1 });
    const last = DateTime.fromJSDate(to, { zone }).startOf('day').plus({ days: 1 });
    if (!day.isValid || !last.isValid) continue;
    // Jump to the first matching weekday, then step one week at a time.
    day = day.plus({ days: (isoDay - day.weekday + 7) % 7 });
    while (day <= last) {
      const at = DateTime.fromObject(
        { year: day.year, month: day.month, day: day.day, hour, minute },
        { zone },
      );
      if (at.isValid) {
        const ms = at.toMillis();
        if (ms >= from.getTime() && ms < to.getTime()) {
          out.push({
            slotId: rule.id,
            platform: rule.platform,
            at: new Date(ms),
            audienceTimezone: zone,
            label: rule.label,
          });
        }
      }
      day = day.plus({ weeks: 1 });
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.slotId.localeCompare(b.slotId));
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.platform}|${c.at.getTime()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface TakenPost {
  platform: Platform;
  at: Date;
}

/** Drops candidates that a post on the same platform already holds (within the window). */
export function removeTaken(
  candidates: readonly SlotCandidate[],
  taken: readonly TakenPost[],
  windowMs = SLOT_CONFLICT_WINDOW_MS,
): SlotCandidate[] {
  if (taken.length === 0) return [...candidates];
  return candidates.filter(
    (c) =>
      !taken.some(
        (t) => t.platform === c.platform && Math.abs(t.at.getTime() - c.at.getTime()) < windowMs,
      ),
  );
}

/** Start of the launch day in the product time zone, or null. */
export function launchStart(launchDate: string | null, productTimezone: string): Date | null {
  if (!launchDate) return null;
  const dt = DateTime.fromISO(launchDate, { zone: productTimezone }).startOf('day');
  return dt.isValid ? dt.toJSDate() : null;
}

/** The earliest instant a slot may use: `from`, or the launch day start when later. */
export function earliestSlotTime(
  from: Date,
  launchDate: string | null,
  productTimezone: string,
): Date {
  const launch = launchStart(launchDate, productTimezone);
  return launch && launch.getTime() > from.getTime() ? launch : from;
}
