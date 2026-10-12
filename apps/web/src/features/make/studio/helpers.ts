/**
 * Pure helpers for the Studio screen (kept apart from components for fast refresh and tests).
 */
import {
  masterAssetKinds,
  type MakeAsset,
  type AssetKind,
  type Brief,
  type Ratio,
  type RenderJob,
  type RenderJobKind,
} from '@growth-desk/contract';
import type { StatusTone } from '@/components/atoms/StatusChip';
import { isApiError } from '@/lib/api';
import { formatBytes, formatTimecode } from './upload';

/** Ratios the preview can switch between (Figma: 9:16, 4:5, 1:1). */
export const PREVIEW_RATIOS: readonly Ratio[] = ['9:16', '4:5', '1:1'];

/** Height of the 300px wide preview for each ratio (Figma: 300 x 375 for 4:5). */
export const PREVIEW_HEIGHT: Record<Ratio, number> = {
  '9:16': 533,
  '4:5': 375,
  '1:1': 300,
  '16:9': 169,
};

/** First sentence of the hook, without quote marks ("You are not a bad friend."). */
export function captionChipText(hook: string | null): string | null {
  const text = hook?.replace(/[“”"]/g, '').trim();
  if (!text) return null;
  const first = /^.+?[.!?](?=\s|$)/.exec(text);
  return (first ? first[0] : text).trim();
}

/** Ready master for a ratio, else any ready master of the right kind. */
export function pickMaster(
  assets: readonly MakeAsset[],
  brief: Pick<Brief, 'kind'>,
  ratio?: Ratio | null,
): MakeAsset | null {
  const kinds = masterAssetKinds(brief.kind);
  const ready = assets.filter((a) => a.status === 'ready' && kinds.includes(a.kind));
  return (ratio ? ready.find((a) => a.ratio === ratio) : undefined) ?? ready[0] ?? null;
}

/** Ready video for the preview ratio, else any ready video. */
export function readyVideo(assets: readonly MakeAsset[], ratio: Ratio): MakeAsset | null {
  const videos = assets.filter((a) => a.status === 'ready' && a.kind === 'video');
  return videos.find((a) => a.ratio === ratio) ?? videos[0] ?? null;
}

/** "Send for review" needs a frozen brief with a ready master asset. */
export function canSendForReview(
  brief: Pick<Brief, 'stage' | 'kind'>,
  assets: readonly MakeAsset[],
): boolean {
  return brief.stage === 'frozen' && pickMaster(assets, brief) !== null;
}

export function assetMeta(asset: MakeAsset): string {
  return [
    asset.ratio,
    formatBytes(asset.sizeBytes),
    asset.durationMs ? formatTimecode(asset.durationMs) : null,
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const RENDER_KIND_LABELS: Record<RenderJobKind, string> = {
  render: 'Render',
  voice: 'Voice',
  mix: 'Mix',
  cutdown: 'Cut-down',
  captions: 'Captions',
};

export function renderJobChip(job: Pick<RenderJob, 'status' | 'progress'>): {
  label: string;
  tone: StatusTone;
} {
  switch (job.status) {
    case 'done':
      return { label: 'Done', tone: 'care' };
    case 'running':
      return { label: `Running ${job.progress}%`, tone: 'joy' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'neutral' };
    default:
      return { label: 'Queued', tone: 'neutral' };
  }
}

export const ASSET_KIND_TITLES: Record<AssetKind, string> = {
  video: 'master video',
  cutdown: 'cut-down',
  poster: 'poster',
  caption: 'caption file',
};

/** Browsers often send no type for .srt and .vtt; fill it from the extension. */
export function guessMimeType(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.srt')) return 'application/x-subrip';
  if (name.endsWith('.vtt')) return 'text/vtt';
  return '';
}

/** True when the API says storage is switched off (no keys set). */
export function isStorageOff(error: unknown): boolean {
  return isApiError(error) && error.code === 'FEATURE_DISABLED';
}

/** Loudness is off target when it is more than 1 LU away from the target. */
export const LOUDNESS_TOLERANCE_LU = 1;

export function formatLufs(value: number): string {
  return `${value.toFixed(1)} LUFS`;
}

export function loudnessLabel(value: number | null, target: number): string {
  return value === null
    ? `Loudness not set (target ${target})`
    : `${formatLufs(value)} (target ${target})`;
}

export function isLoudnessOffTarget(value: number, target: number): boolean {
  return Math.abs(value - target) > LOUDNESS_TOLERANCE_LU;
}

/** Parses the loudness input. Empty means "not set". Returns an error text when not valid. */
export function parseLufsInput(raw: string): { value: number | null } | { error: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  const n = Number(text);
  if (!Number.isFinite(n) || n < -70 || n > 0) return { error: 'Use a number from -70 to 0.' };
  return { value: Math.round(n * 10) / 10 };
}

/** Kinds that carry a sound mix, so loudness applies. */
export function hasLoudness(kind: AssetKind): boolean {
  return kind === 'video' || kind === 'cutdown';
}
