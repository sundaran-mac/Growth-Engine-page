/**
 * Read-only scene timeline built from the brief (Figma 241:990 "Scene timeline").
 * Lanes: video (hook, beats, end card), voice (one block per spoken part), captions, music.
 * Positions are fractions of the lane (0..1) so the view can scale to any width.
 */
import { LANGUAGE_LABELS, type MakeAsset, type Brief, type Language } from '@growth-desk/contract';

export const DEFAULT_DURATION_MS = 58_000;

/** Short parts (hook, end card) weigh a bit over half a beat, as in the Figma frame. */
const SHORT_WEIGHT = 0.56;
/** Gap between video blocks, as a fraction of the lane. */
const GAP = 0.00625;
/** Voice blocks sit inside their video block with this inset on each side. */
const VOICE_INSET_SHORT = 0.14;
const VOICE_INSET_BEAT = 0.07;

export type SegmentTone = 'joy-soft' | 'sunken' | 'joy' | 'care-soft' | 'joy-badge';

export interface TimelineSegment {
  key: string;
  label: string;
  /** Fraction of the lane, 0..1. */
  start: number;
  width: number;
  startMs: number;
  endMs: number;
  tone: SegmentTone;
  /** Full text for the tooltip / screen reader (hook or beat text). */
  detail: string | null;
}

export interface TimelineLane {
  key: 'video' | 'voice' | 'captions' | 'music';
  label: string;
  segments: TimelineSegment[];
}

export interface SceneTimeline {
  durationMs: number;
  estimated: boolean;
  lanes: TimelineLane[];
}

export function captionLaneLabel(languages: readonly Language[]): string {
  if (languages.length === 0) return 'No caption languages set';
  return `${languages.map((l) => l.toUpperCase()).join(' + ')} burned in`;
}

export function captionLanguagesText(languages: readonly Language[]): string {
  return languages.map((l) => LANGUAGE_LABELS[l]).join(' · ');
}

export function buildSceneTimeline(
  brief: Pick<Brief, 'hook' | 'beats' | 'captionLanguages'>,
  master: Pick<MakeAsset, 'durationMs' | 'licence'> | null,
): SceneTimeline {
  const durationMs = master?.durationMs && master.durationMs > 0 ? master.durationMs : DEFAULT_DURATION_MS;
  const estimated = !(master?.durationMs && master.durationMs > 0);

  const parts: { key: string; label: string; weight: number; tone: SegmentTone; detail: string | null }[] = [
    { key: 'hook', label: 'Hook', weight: SHORT_WEIGHT, tone: 'joy-soft', detail: brief.hook },
    ...brief.beats.map((b, i) => ({
      key: `beat-${i + 1}`,
      label: `Beat ${i + 1}`,
      weight: 1,
      tone: 'sunken' as const,
      detail: b,
    })),
    { key: 'end', label: 'End card', weight: SHORT_WEIGHT, tone: 'joy', detail: null },
  ];

  const gaps = GAP * (parts.length + 1);
  const usable = 1 - gaps;
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  let cursor = GAP / 2;
  const video: TimelineSegment[] = parts.map((p) => {
    const width = (p.weight / totalWeight) * usable;
    const seg: TimelineSegment = {
      key: p.key,
      label: p.label,
      start: cursor,
      width,
      startMs: Math.round(cursor * durationMs),
      endMs: Math.round((cursor + width) * durationMs),
      tone: p.tone,
      detail: p.detail,
    };
    cursor += width + GAP;
    return seg;
  });

  const voice: TimelineSegment[] = video.map((v, i) => {
    const inset = v.key === 'hook' || v.key === 'end' ? VOICE_INSET_SHORT : VOICE_INSET_BEAT;
    const start = v.start + v.width * inset;
    const width = v.width * (1 - inset * 2);
    return {
      key: `vo${i}`,
      label: `vo${i}`,
      start,
      width,
      startMs: Math.round(start * durationMs),
      endMs: Math.round((start + width) * durationMs),
      tone: 'care-soft',
      detail: v.detail,
    };
  });

  const full = (key: string, label: string, tone: SegmentTone): TimelineSegment => ({
    key,
    label,
    start: GAP / 2,
    width: 1 - GAP,
    startMs: 0,
    endMs: durationMs,
    tone,
    detail: null,
  });

  const musicLabel = master?.licence
    ? 'Licensed track · ducked under voice'
    : 'No licensed track yet';

  return {
    durationMs,
    estimated,
    lanes: [
      { key: 'video', label: 'Video', segments: video },
      { key: 'voice', label: 'Voice', segments: voice },
      {
        key: 'captions',
        label: 'Captions',
        segments: [full('captions', captionLaneLabel(brief.captionLanguages), 'joy-badge')],
      },
      { key: 'music', label: 'Music', segments: [full('music', musicLabel, 'sunken')] },
    ],
  };
}
