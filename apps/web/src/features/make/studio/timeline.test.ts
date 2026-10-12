import { describe, expect, it } from 'vitest';
import { buildSceneTimeline, captionLaneLabel, DEFAULT_DURATION_MS } from './timeline';

describe('buildSceneTimeline', () => {
  const brief = {
    hook: 'Hook text',
    beats: ['One', 'Two', 'Three'],
    captionLanguages: ['en', 'ta'] as const,
  };

  it('builds video lane from hook, beats and end card, in order and inside the lane', () => {
    const t = buildSceneTimeline({ ...brief, captionLanguages: [...brief.captionLanguages] }, null);
    const video = t.lanes.find((l) => l.key === 'video')!;
    expect(video.segments.map((s) => s.label)).toEqual([
      'Hook',
      'Beat 1',
      'Beat 2',
      'Beat 3',
      'End card',
    ]);
    const hook = video.segments[0]!;
    const beat = video.segments[1]!;
    expect(hook.width).toBeLessThan(beat.width);
    for (let i = 1; i < video.segments.length; i++) {
      expect(video.segments[i]!.start).toBeGreaterThan(
        video.segments[i - 1]!.start + video.segments[i - 1]!.width,
      );
    }
    const last = video.segments.at(-1)!;
    expect(last.start + last.width).toBeLessThanOrEqual(1);
    expect(hook.detail).toBe('Hook text');
  });

  it('puts one voice block inside each video block', () => {
    const t = buildSceneTimeline({ ...brief, captionLanguages: ['en'] }, null);
    const [video, voice] = t.lanes;
    expect(voice!.segments.map((s) => s.label)).toEqual(['vo0', 'vo1', 'vo2', 'vo3', 'vo4']);
    voice!.segments.forEach((v, i) => {
      const host = video!.segments[i]!;
      expect(v.start).toBeGreaterThanOrEqual(host.start);
      expect(v.start + v.width).toBeLessThanOrEqual(host.start + host.width);
    });
  });

  it('uses the master duration and licence when present, else an estimate', () => {
    const est = buildSceneTimeline({ hook: null, beats: [], captionLanguages: [] }, null);
    expect(est.durationMs).toBe(DEFAULT_DURATION_MS);
    expect(est.estimated).toBe(true);
    expect(est.lanes[0]!.segments.map((s) => s.label)).toEqual(['Hook', 'End card']);
    expect(est.lanes[3]!.segments[0]!.label).toBe('No licensed track yet');

    const real = buildSceneTimeline(
      { hook: 'h', beats: ['b'], captionLanguages: ['en'] },
      { durationMs: 30_000, licence: 'Track' },
    );
    expect(real.durationMs).toBe(30_000);
    expect(real.estimated).toBe(false);
    expect(real.lanes[3]!.segments[0]!.label).toBe('Licensed track · ducked under voice');
    expect(real.lanes[0]!.segments.at(-1)!.endMs).toBeLessThanOrEqual(30_000);
  });

  it('labels the caption lane from languages', () => {
    expect(captionLaneLabel(['en', 'ta'])).toBe('EN + TA burned in');
    expect(captionLaneLabel([])).toBe('No caption languages set');
  });
});
