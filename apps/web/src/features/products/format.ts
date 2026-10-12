/**
 * Labels, tones and icons shared by the Products, Product kit and Integrations screens.
 */
import {
  ChartLine,
  ChatCircle,
  FacebookLogo,
  FilmStrip,
  HardDrives,
  Handshake,
  InstagramLogo,
  LinkedinLogo,
  NotePencil,
  PuzzlePiece,
  Sparkle,
  Stack,
  WhatsappLogo,
  YoutubeLogo,
} from '@phosphor-icons/react';
import { format } from 'date-fns';
import {
  PRODUCT_STATUS_LABELS,
  type ChannelStatus,
  type IntegrationStatus,
  type Platform,
  type ProductStatus,
  type ProductSummary,
} from '@growth-desk/contract';
import type { IconComponent } from '@/components/atoms/Icon';
import type { StatusTone } from '@/components/atoms/StatusChip';
import { isApiError } from '@/lib/api';

export const PLATFORM_ICONS: Record<Platform, IconComponent> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  youtube: YoutubeLogo,
  linkedin: LinkedinLogo,
  whatsapp: WhatsappLogo,
};

export const TOOL_ICONS: Record<string, IconComponent> = {
  claude: Sparkle,
  github: NotePencil,
  'google-drive': Stack,
  'hand-off-tools': FilmStrip,
  analytics: ChartLine,
  hubspot: Handshake,
  'comment-to-dm': ChatCircle,
  storage: HardDrives,
};
export const DEFAULT_TOOL_ICON: IconComponent = PuzzlePiece;

/** Chip tone per product status (Figma: in build = joy, live = care, draft = sunken). */
export const PRODUCT_STATUS_TONE: Record<ProductStatus, StatusTone> = {
  in_build: 'joy',
  live: 'care',
  draft: 'neutral',
  archived: 'neutral',
};

/** "IN BUILD · v2", "LIVE · pulse.humini.app", "DRAFT". */
export function productStatusText(status: ProductStatus, note: string | null): string {
  const label = PRODUCT_STATUS_LABELS[status].toUpperCase();
  return note ? `${label} · ${note}` : label;
}

/** Kit bar colour: full = joy, part = care, low = border (Figma 239:993, 239:1023, 239:1053). */
export function kitBarClass(score: number): string {
  if (score >= 10) return 'bg-joy';
  if (score >= 5) return 'bg-care';
  return 'bg-strong';
}

/** "8 Oct". */
export function shortDate(isoValue: string): string {
  return format(new Date(isoValue), 'd MMM');
}

/** "Kit 10/10 · signed 8 Oct", "Kit 6/10 · owner to confirm", "Kit 2/10". */
export function kitLine(p: ProductSummary): string {
  const score = p.kit?.score ?? 0;
  const parts = [`Kit ${score}/10`];
  if (p.kit?.signedAt) parts.push(`signed ${shortDate(p.kit.signedAt)}`);
  else if (!p.owner && p.status !== 'draft') parts.push('owner to confirm');
  return parts.join(' · ');
}

/** "36 pieces · 214 installs" or "Not in market". */
export function thisMonthText(p: ProductSummary): string {
  const { piecesThisMonth: pieces, installsThisMonth: installs } = p.stats;
  if (pieces === 0 && installs === 0 && p.status === 'draft') return 'Not in market';
  return `${pieces} ${pieces === 1 ? 'piece' : 'pieces'} · ${installs} ${installs === 1 ? 'install' : 'installs'}`;
}

export const CHANNEL_STATUS_VIEW: Record<ChannelStatus, { label: string; tone: StatusTone }> = {
  connected: { label: 'Connected', tone: 'care' },
  needs_approval: { label: 'Needs app approval', tone: 'reminder' },
  manual: { label: 'Manual', tone: 'reminder' },
  disconnected: { label: 'Not connected', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

export const TOOL_STATUS_VIEW: Record<IntegrationStatus, { label: string; tone: StatusTone }> = {
  connected: { label: 'Connected', tone: 'care' },
  hand_off: { label: 'Hand-off', tone: 'reminder' },
  check_first: { label: 'Check first', tone: 'reminder' },
  not_set_up: { label: 'Not set up', tone: 'neutral' },
  disabled: { label: 'Off', tone: 'neutral' },
};

/** Title and detail for a toast from any thrown value. */
export function problemText(
  error: unknown,
  fallback = 'Something went wrong',
): { title: string; description?: string } {
  if (isApiError(error)) {
    const fieldErrors = error.errors.map((e) => e.message).join(' ');
    const description = error.detail ?? (fieldErrors || undefined);
    return description ? { title: error.title, description } : { title: error.title };
  }
  return { title: fallback };
}

/** Arguments for `toast.error(...)` from any thrown value. */
export function toastArgs(error: unknown): [string, { description?: string }] {
  const { title, description } = problemText(error);
  return [title, description ? { description } : {}];
}

/** "my product" -> "my-product". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
