/**
 * Pure plan logic: month calendar weeks (Monday first), mode mix and the "things to fix" warnings.
 * No database here, so it is unit tested directly.
 */
import { CONTENT_MODES, type ContentMode, type PlanWarning } from '@growth-desk/contract';

const DAY_MS = 86_400_000;

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { year: y, monthIndex: m - 1 };
}

/** First and last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
export function monthRange(month: string): { first: string; last: string } {
  const { year, monthIndex } = parseMonth(month);
  const first = Date.UTC(year, monthIndex, 1);
  const last = Date.UTC(year, monthIndex + 1, 0);
  return { first: toIso(first), last: toIso(last) };
}

export function isDateInMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month;
}

/**
 * Calendar rows for a month, Monday first. Each row has 7 ISO dates; days outside the month
 * are included so the grid is full (like the Figma November plan, which starts on 26 Oct).
 */
export function calendarWeeks(month: string): string[][] {
  const { year, monthIndex } = parseMonth(month);
  const first = Date.UTC(year, monthIndex, 1);
  const last = Date.UTC(year, monthIndex + 1, 0);
  const isoWeekday = ((new Date(first).getUTCDay() + 6) % 7) + 1; // 1 = Monday
  let cursor = first - (isoWeekday - 1) * DAY_MS;
  const weeks: string[][] = [];
  while (cursor <= last) {
    const row: string[] = [];
    for (let i = 0; i < 7; i++) row.push(toIso(cursor + i * DAY_MS));
    weeks.push(row);
    cursor += 7 * DAY_MS;
  }
  return weeks;
}

export interface CheckItem {
  id: string;
  date: string;
  mode: ContentMode | null;
  needsShootSlot: boolean;
}

/** Another product with a signed kit, and the dates of its plan items this month. */
export interface OtherProductPlan {
  productId: string;
  /** Short name as on the Figma ("Pulse"). */
  name: string;
  dates: readonly string[];
}

/**
 * Week numbers (1 = the row that holds the 1st) that this month owns and that have no date in
 * `dates`. A week belongs to the month that holds its Thursday (the ISO rule).
 */
export function emptyWeeks(month: string, dates: ReadonlySet<string>): { week: number; owned: number }[] {
  const out: { week: number; owned: number }[] = [];
  const rows = calendarWeeks(month);
  const owned = rows.filter((row) => isDateInMonth(row[3]!, month)).length;
  rows.forEach((row, index) => {
    const ownsWeek = isDateInMonth(row[3]!, month);
    const monthDays = row.filter((d) => isDateInMonth(d, month));
    if (ownsWeek && !monthDays.some((d) => dates.has(d))) out.push({ week: index + 1, owned });
  });
  return out;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Cross-product check (Figma: "No Pulse piece in week 3"): for every other product with a
 * signed kit, flag each week of the month with nothing planned for it. A product with nothing
 * at all this month gets one warning instead of one per week.
 */
export function crossProductWarnings(month: string, others: readonly OtherProductPlan[]): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  const monthName = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  for (const other of [...others].sort((a, b) => a.name.localeCompare(b.name))) {
    const dates = new Set(other.dates.filter((d) => isDateInMonth(d, month)));
    const gaps = emptyWeeks(month, dates);
    if (gaps.length === 0) continue;
    if (dates.size === 0) {
      warnings.push({
        code: 'PRODUCT_EMPTY_WEEK',
        message: `No ${other.name} piece planned in ${monthName}`,
        itemIds: [],
        week: null,
        productId: other.productId,
      });
      continue;
    }
    for (const g of gaps) {
      warnings.push({
        code: 'PRODUCT_EMPTY_WEEK',
        message: `No ${other.name} piece in week ${g.week}`,
        itemIds: [],
        week: g.week,
        productId: other.productId,
      });
    }
  }
  return warnings;
}

export interface PlanCheckResult {
  total: number;
  mix: { mode: ContentMode; count: number }[];
  warnings: PlanWarning[];
}

/**
 * Mix: pieces per mode, every mode listed, sorted by count (high first), then M1..M7.
 * Warnings:
 * - NO_SHOOT_SLOT: founder films (M1) marked as still needing a shoot slot.
 * - EMPTY_WEEK: a calendar week of this month with no piece. A week belongs to the month that
 *   holds its Thursday (the ISO rule), so a row with only one or two days of the month is checked
 *   by the neighbouring month's plan instead.
 * Cross-product gaps (PRODUCT_EMPTY_WEEK) come from `crossProductWarnings`.
 */
export function computePlanChecks(
  month: string,
  items: readonly CheckItem[],
  productName: string,
): PlanCheckResult {
  const inMonth = items.filter((i) => isDateInMonth(i.date, month));
  const counts = new Map<ContentMode, number>(CONTENT_MODES.map((m) => [m, 0]));
  for (const item of inMonth) {
    if (item.mode) counts.set(item.mode, (counts.get(item.mode) ?? 0) + 1);
  }
  const mix = CONTENT_MODES.map((mode) => ({ mode, count: counts.get(mode) ?? 0 })).sort(
    (a, b) => b.count - a.count || CONTENT_MODES.indexOf(a.mode) - CONTENT_MODES.indexOf(b.mode),
  );

  const warnings: PlanWarning[] = [];
  const unbooked = inMonth.filter((i) => i.mode === 'M1' && i.needsShootSlot);
  if (unbooked.length > 0) {
    warnings.push({
      code: 'NO_SHOOT_SLOT',
      message:
        unbooked.length === 1
          ? '1 founder film has no shoot slot'
          : `${unbooked.length} founder films have no shoot slot`,
      itemIds: unbooked.map((i) => i.id),
      week: null,
      productId: null,
    });
  }

  for (const { week } of emptyWeeks(month, new Set(inMonth.map((i) => i.date)))) {
    warnings.push({
      code: 'EMPTY_WEEK',
      message: `No ${productName} piece in week ${week}`,
      itemIds: [],
      week,
      productId: null,
    });
  }

  return { total: inMonth.length, mix, warnings };
}
