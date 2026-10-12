/**
 * Pure helpers for the Ideas and Plan screens: mode colours from Figma, month maths, permissions.
 */
import { CONTENT_MODE_LABELS, type ContentMode, type IdeaGenerateResponse, type Membership, type Role } from '@growth-desk/contract';

export function modeLabel(mode: ContentMode): string {
  return `${mode} ${CONTENT_MODE_LABELS[mode]}`;
}

/** Card chip on the Ideas board (Figma 240:847): soft tints. */
export const MODE_CHIP_CLASS: Record<ContentMode, string> = {
  M1: 'bg-joy-soft text-ink',
  M2: 'bg-care-soft text-ink',
  M3: 'bg-joy-soft text-ink',
  M4: 'bg-joy-soft/60 text-ink',
  M5: 'bg-surface-sunken text-ink',
  M6: 'bg-care-soft text-ink',
  M7: 'bg-media-canvas text-media-text',
};

/** Calendar pieces and mix bars on the Plan (Figma 240:1053): one colour per mode. */
export const MODE_PLAN_CLASS: Record<ContentMode, string> = {
  M1: 'bg-joy text-ink',
  M2: 'bg-care text-media-text',
  M3: 'bg-joy-soft text-ink',
  M4: 'bg-joy-badge text-ink',
  M5: 'bg-surface-sunken text-ink',
  M6: 'bg-care-soft text-ink',
  M7: 'bg-media-canvas text-media-text',
};

/** Pieces with no mode (occasion posts like "Deepavali circle"). */
export const NO_MODE_PLAN_CLASS = 'bg-care-soft text-ink';

/* ---------- Months ---------- */

const pad = (n: number) => String(n).padStart(2, '0');

export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function isMonthKey(s: string | null | undefined): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Plans are made ahead: by default the Plan opens on next month. */
export function defaultPlanMonth(today = new Date()): string {
  return addMonths(toMonthKey(today), 1);
}

export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function monthTitle(month: string): string {
  const [y] = month.split('-');
  return `${monthName(month)} ${y}`;
}

export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** Monday-first weeks covering the month, as ISO dates (days of other months included). */
export function calendarWeeks(month: string): string[][] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  let cursor = first - offset * 86_400_000;
  const weeks: string[][] = [];
  while (cursor <= last) {
    const row: string[] = [];
    for (let i = 0; i < 7; i++) row.push(new Date(cursor + i * 86_400_000).toISOString().slice(0, 10));
    weeks.push(row);
    cursor += 7 * 86_400_000;
  }
  return weeks;
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/* ---------- Permissions (mirror of the API rules in modules/ideas/access.ts) ---------- */

export interface IdeasPermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canFreeze: boolean;
  canUnfreeze: boolean;
  canAddOccasion: boolean;
}

export function ideasPermissions(
  user: { role: Role } | null,
  memberships: readonly Membership[],
  productId: string | null,
): IdeasPermissions {
  if (!user || !productId) {
    return { canRead: false, canWrite: false, canDelete: false, canFreeze: false, canUnfreeze: false, canAddOccasion: false };
  }
  const roles = memberships.filter((m) => m.productId === productId).map((m) => m.productRole);
  const admin = user.role === 'admin';
  const editor = admin || user.role === 'editor';
  return {
    canRead: editor || user.role === 'viewer' || roles.length > 0,
    canWrite: editor || roles.some((r) => r === 'owner' || r === 'backup' || r === 'maker'),
    canDelete: editor,
    canFreeze: editor || roles.includes('owner'),
    canUnfreeze: admin,
    canAddOccasion: editor,
  };
}

/** Toast line after a run: how many drafts were dropped as repeats, and why others were dropped. */
export function generateSummary(res: Pick<IdeaGenerateResponse, 'dropped' | 'droppedAsDuplicate' | 'rounds'>): string {
  const parts: string[] = [];
  if (res.droppedAsDuplicate > 0) {
    parts.push(
      `${res.droppedAsDuplicate} dropped as ${res.droppedAsDuplicate === 1 ? 'a repeat' : 'repeats'} of earlier ideas (any product).`,
    );
  }
  const other = res.dropped - res.droppedAsDuplicate;
  if (other > 0) parts.push(`${other} left out: never-say words, a different mode, or more than you asked for.`);
  if (res.rounds > 1) parts.push(`Claude was asked ${res.rounds} times to fill the gap.`);
  return parts.length > 0 ? parts.join(' ') : 'They are in the New from Claude column.';
}
