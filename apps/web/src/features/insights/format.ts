/**
 * Display helpers for Home, Analytics and Sales. Pure functions, unit tested.
 */
import {
  InstagramLogo,
  FacebookLogo,
  YoutubeLogo,
  LinkedinLogo,
  WhatsappLogo,
} from '@phosphor-icons/react';
import type { Platform } from '@growth-desk/contract';
import type { IconComponent } from '@/components/atoms/Icon';

export const PLATFORM_ICONS: Record<Platform, IconComponent> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
};

/** 48200 -> "48.2k", 1930 -> "1,930", 1250000 -> "1.3M". */
export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${trim1(n / 1_000_000)}M`;
  if (n >= 10_000) return `${trim1(n / 1_000)}k`;
  return n.toLocaleString('en-US');
}

function trim1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** "+12% vs last week", "-5% vs last week"; pass `vs = ''` for a bare "+12%". */
export function deltaText(pct: number | null, vs = 'last week'): string {
  if (pct === null) return vs ? 'No numbers for the week before' : 'No earlier numbers';
  if (pct === 0) return vs ? `Same as ${vs}` : 'No change';
  return `${pct > 0 ? '+' : ''}${pct}%${vs ? ` vs ${vs}` : ''}`;
}

/** Short zone names the team reads every day. Others fall back to Intl. */
const ZONE_ABBR: Record<string, string> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'Asia/Singapore': 'SGT',
  'Asia/Dubai': 'GST',
  'Asia/Kuala_Lumpur': 'MYT',
  'Europe/London': 'UK',
  UTC: 'UTC',
};

export function zoneAbbr(tz: string, at: Date = new Date()): string {
  const known = ZONE_ABBR[tz];
  if (known) return known;
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

/** "7:30 pm IST" in the audience zone. */
export function timeInZone(iso: string, tz: string): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
    .format(at)
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return `${time} ${zoneAbbr(tz, at)}`;
}

/** "Thu 8:00 pm IST" in the audience zone. */
export function dayTimeInZone(iso: string, tz: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(
    new Date(iso),
  );
  return `${day} ${timeInZone(iso, tz)}`;
}

/** "Tuesday 13 October" for a YYYY-MM-DD date. */
export function longDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "waiting 6 h", "waiting 25 min", "waiting 2 d". */
export function waitingFor(sinceIso: string, now: Date = new Date()): string {
  const min = Math.max(0, Math.round((now.getTime() - new Date(sinceIso).getTime()) / 60_000));
  if (min < 60) return `waiting ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `waiting ${h} h`;
  return `waiting ${Math.round(h / 24)} d`;
}

/** Greeting by the viewer's local hour. */
export function greeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "1 thing needs you today" / "3 things need you today" / "Nothing needs you today". */
export function needsYouLine(n: number): string {
  if (n === 0) return 'Nothing needs you today';
  return n === 1 ? '1 thing needs you today' : `${n} things need you today`;
}

/** Chip tone for a product: green products use the care chip, the rest the joy chip (Figma Sales). */
export function productChipTone(color: string | null): 'joy' | 'care' | 'neutral' {
  if (!color) return 'neutral';
  const hex = color.replace('#', '');
  if (hex.length !== 6) return 'neutral';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if (g > r && g >= b) return 'care';
  if (b > r && b > g) return 'neutral';
  return 'joy';
}

/** Rows to CSV text (quotes every cell, so commas and quotes are safe). */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
