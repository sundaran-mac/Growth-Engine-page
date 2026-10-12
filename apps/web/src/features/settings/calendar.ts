/** Calendar ranges for the Schedule screen (Monday first, viewer's local time). */
import { addDays, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';

export type ScheduleView = 'week' | 'month';

const WEEK_OPTS = { weekStartsOn: 1 } as const;

/** Visible range for a view (whole weeks, Monday first). */
export function visibleRange(
  view: ScheduleView,
  anchor: Date,
): { start: Date; end: Date; days: Date[] } {
  const start =
    view === 'week' ? startOfWeek(anchor, WEEK_OPTS) : startOfWeek(startOfMonth(anchor), WEEK_OPTS);
  const lastDay =
    view === 'week' ? endOfWeek(anchor, WEEK_OPTS) : endOfWeek(endOfMonth(anchor), WEEK_OPTS);
  const days: Date[] = [];
  for (let d = start; d <= lastDay; d = addDays(d, 1)) days.push(d);
  return { start, end: addDays(startOfDay(lastDay), 1), days };
}

export function parseAnchor(raw: string | null): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}
