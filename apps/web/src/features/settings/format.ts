/**
 * Small helpers for the Settings and Schedule screens: platform icons, time zones, times.
 */
import {
  FacebookLogo,
  InstagramLogo,
  LinkedinLogo,
  WhatsappLogo,
  YoutubeLogo,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import {
  DOCUMENT_MIME_TYPES,
  PLATFORM_LABELS,
  type DocumentMimeType,
  type Platform,
} from '@growth-desk/contract';
import { isApiError } from '@/lib/api';

export const PLATFORM_ICONS: Record<Platform, PhosphorIcon> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
};

export const platformLabel = (p: Platform) => PLATFORM_LABELS[p];

/** Zones the team uses most; any other valid zone also works. */
export const COMMON_TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Dubai',
  'Asia/Kuala_Lumpur',
  'Asia/Colombo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'UTC',
] as const;

/** Common zones first, then every zone the browser knows. */
export function timeZoneOptions(current?: string | null): string[] {
  const list: string[] = [...COMMON_TIME_ZONES];
  try {
    const all =
      (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      ) ?? [];
    for (const z of all) if (!list.includes(z)) list.push(z);
  } catch {
    /* older browser: common list only */
  }
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Short zone name, for example "IST" or "GMT+8". */
export function zoneAbbr(iso: string, timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date(iso))
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "Thu 15 Oct, 7:30 pm" in the zone. */
export function formatDayTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\s+/g, ' ');
}

/** "7:30 pm" in the zone. */
export function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** "12 Oct 2026, 7:30 am" in the viewer zone. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function formatBytes(n: number | null): string {
  if (n === null) return '';
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Toast arguments from any error (problem+json title and detail when present). */
export function errorToast(
  error: unknown,
  fallback = 'Something went wrong',
): [string, { description?: string }] {
  if (isApiError(error)) {
    const field = error.errors[0];
    const description = error.detail ?? (field ? `${field.path}: ${field.message}` : undefined);
    return [error.title, description ? { description } : {}];
  }
  if (error instanceof Error) return [fallback, { description: error.message }];
  return [fallback, {}];
}

/** Tracked link preview in the same shape as the Publish screen. */
export function buildTrackedLink(input: {
  baseUrl: string | null;
  prefix: string | null;
  platform: Platform;
  medium: string;
  theme: string;
  month: Date;
  contentCode: string;
}): string | null {
  if (!input.baseUrl) return null;
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    return null;
  }
  const mon = input.month.toLocaleString('en-GB', { month: 'short' }).toLowerCase();
  const campaign = [input.prefix, input.theme, mon].filter(Boolean).join('-');
  url.searchParams.set('utm_source', input.platform);
  url.searchParams.set('utm_medium', input.medium);
  url.searchParams.set('utm_campaign', campaign);
  url.searchParams.set('utm_content', input.contentCode);
  return url.toString();
}

/** Browser file type to an allowed mime type (Markdown files often come with no type). */
export function mimeFor(file: { name: string; type: string }): DocumentMimeType | null {
  const name = file.name.toLowerCase();
  if ((DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type))
    return file.type as DocumentMimeType;
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'text/markdown';
  if (name.endsWith('.txt')) return 'text/plain';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'text/html';
  return null;
}
