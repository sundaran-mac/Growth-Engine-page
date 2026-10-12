/**
 * Pure display helpers for the Publish screens (unit tested in format.test.ts).
 */
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import type { BriefKind, Language, Platform, PostView, PublishHow } from '@growth-desk/contract';
import { isApiError } from '@/lib/api';

/** Channel label like "Instagram Reel", "YouTube Short", "LinkedIn · Elan", "WhatsApp Channel". */
export function channelLabel(
  platform: Platform,
  kind: BriefKind | undefined,
  displayName?: string,
): string {
  const isVideo = kind === undefined || kind === 'reel' || kind === 'short';
  switch (platform) {
    case 'instagram':
      return isVideo ? 'Instagram Reel' : 'Instagram Post';
    case 'facebook':
      return isVideo ? 'Facebook Reel' : 'Facebook Post';
    case 'youtube':
      return isVideo ? 'YouTube Short' : 'YouTube';
    case 'linkedin':
      return displayName && displayName !== 'LinkedIn' ? `LinkedIn · ${displayName}` : 'LinkedIn';
    case 'whatsapp':
      return 'WhatsApp Channel';
  }
}

const HOW_API: Record<Platform, string> = {
  instagram: 'Meta API',
  facebook: 'Meta API',
  youtube: 'YouTube API',
  linkedin: 'LinkedIn API',
  whatsapp: 'by hand',
};

/** HOW column text from the Figma: "Auto · Meta API", "Needs API approval", "Reminder · by hand". */
export function howLabel(how: PublishHow, platform: Platform): string {
  switch (how) {
    case 'auto':
      return `Auto · ${HOW_API[platform]}`;
    case 'needs_approval':
      return 'Needs API approval';
    case 'reminder':
      return 'Reminder · by hand';
    case 'not_connected':
      return 'Not connected';
  }
}

export function howTone(how: PublishHow): 'care' | 'joy' | 'danger' {
  if (how === 'auto') return 'care';
  if (how === 'not_connected') return 'danger';
  return 'joy';
}

/** "EN + TA" from a language list. Empty list gives a dash. */
export function languagesLabel(languages: readonly Language[]): string {
  return languages.length === 0 ? '-' : languages.map((l) => l.toUpperCase()).join(' + ');
}

/** Common audience zones whose short names Intl does not give in every locale. */
const ZONE_ABBR: Record<string, string> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'Asia/Singapore': 'SGT',
  'Asia/Dubai': 'GST',
  'Asia/Kuala_Lumpur': 'MYT',
};

/** Short zone name like IST, SGT or GMT+4 for an instant. */
export function zoneAbbr(date: Date, timeZone: string): string {
  const known = ZONE_ABBR[timeZone];
  if (known) return known;
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** "Thu 7:30 pm IST" for an ISO instant in a zone. */
export function formatWhen(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const period = (parts.dayPeriod ?? '').toLowerCase();
  return `${parts.weekday} ${parts.hour}:${parts.minute} ${period} ${zoneAbbr(date, timeZone)}`
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Thu 15 Oct, 7:30 pm" style date for lists, in the viewer zone. */
export function formatShortDateTime(iso: string, timeZone: string = viewerTimeZone()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Value for an `<input type="datetime-local">` showing the instant in `timeZone`. */
export function toZonedInputValue(iso: string, timeZone: string): string {
  return format(new TZDate(new Date(iso).getTime(), timeZone), "yyyy-MM-dd'T'HH:mm");
}

/** ISO instant for a `datetime-local` value read as wall-clock time in `timeZone`. Null when invalid. */
export function fromZonedInputValue(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new TZDate(y, mo - 1, d, h, mi, timeZone);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime()).toISOString();
}

/** Rows that the worker will pick up soon: keep polling while any exist. */
export function needsPolling(
  posts: readonly PostView[] | undefined,
  now: number = Date.now(),
): boolean {
  if (!posts) return false;
  return posts.some(
    (p) =>
      p.status === 'publishing' ||
      (p.status === 'scheduled' &&
        p.scheduledAt !== null &&
        new Date(p.scheduledAt).getTime() <= now + 60_000),
  );
}

export const EDITABLE_STATUSES = new Set<PostView['status']>([
  'draft',
  'scheduled',
  'failed',
  'manual_pending',
]);

/** Toast text for a failed request. */
export function errorText(error: unknown): { title: string; description: string | undefined } {
  if (isApiError(error)) return { title: error.title, description: error.detail };
  if (error instanceof Error) return { title: 'Something went wrong', description: error.message };
  return { title: 'Something went wrong', description: undefined };
}
