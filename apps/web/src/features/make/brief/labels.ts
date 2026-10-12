/**
 * Small display helpers for briefs (Figma 240:1314 fact cards and the Briefs list).
 */
import {
  BRIEF_STAGES,
  type ClaimFlag,
  CONTENT_MODE_LABELS,
  CONTENT_MODE_LONG_LABELS,
  LANGUAGE_LABELS,
  type BriefStage,
  type ContentMode,
  type Language,
  type Platform,
  type Ratio,
  type UserRef,
} from '@growth-desk/contract';
import type { StatusTone } from '@/components/atoms/StatusChip';

/** Short channel names used on the brief ("IG · YT · LinkedIn"). */
export const PLATFORM_SHORT: Record<Platform, string> = {
  instagram: 'IG',
  facebook: 'FB',
  youtube: 'YT',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp',
};

export const EMPTY_VALUE = 'Not set';

export function joinDot(parts: readonly string[]): string {
  return parts.length > 0 ? parts.join(' · ') : EMPTY_VALUE;
}

export const formatRatios = (ratios: readonly Ratio[]) => joinDot(ratios);
export const formatLanguages = (langs: readonly Language[]) => joinDot(langs.map((l) => LANGUAGE_LABELS[l]));
export const formatChannels = (channels: readonly Platform[]) => joinDot(channels.map((c) => PLATFORM_SHORT[c]));

export function firstName(user: UserRef | null | undefined): string | null {
  if (!user) return null;
  return user.name.trim().split(/\s+/)[0] ?? user.name;
}

export function formatApprovers(brand: UserRef | null, claims: UserRef | null): string {
  return joinDot([firstName(brand), firstName(claims)].filter((n): n is string => Boolean(n)));
}

/** "M1 Founder film" style label (singular form of the long label). */
export function modeLabel(mode: ContentMode): string {
  return `${mode} ${CONTENT_MODE_LABELS[mode]}`;
}

export function modeLongLabel(mode: ContentMode): string {
  return `${mode} ${CONTENT_MODE_LONG_LABELS[mode].replace(/s$/, '')}`;
}

export function stageIndex(stage: BriefStage): number {
  return BRIEF_STAGES.indexOf(stage);
}

export const STAGE_TONES: Record<BriefStage, StatusTone> = {
  idea: 'neutral',
  brief: 'joy',
  frozen: 'dark',
  made: 'joy',
  reviewed: 'care',
  approved: 'success',
  scheduled: 'scheduled',
  live: 'success',
};

/** Toggle one value inside a list, keeping the canonical order of `all`. */
export function toggleIn<T>(list: readonly T[], value: T, all: readonly T[]): T[] {
  const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  return all.filter((v) => next.includes(v));
}

/** True when any flag is red (freeze is refused). */
export function isBlocking(flags: readonly ClaimFlag[]): boolean {
  return flags.some((f) => f.status === 'fail');
}
