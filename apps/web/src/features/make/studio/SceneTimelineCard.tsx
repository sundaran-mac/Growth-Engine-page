import type { MakeAsset, Brief } from '@growth-desk/contract';
import { Panel } from '@/components/organisms/Panel';
import { cn } from '@/lib/utils';
import { buildSceneTimeline, type SegmentTone } from './timeline';
import { formatTimecode } from './upload';

const toneClass: Record<SegmentTone, string> = {
  'joy-soft': 'bg-joy-soft',
  sunken: 'bg-surface-sunken',
  joy: 'bg-joy',
  'care-soft': 'bg-care-soft',
  'joy-badge': 'bg-joy-soft/60',
};

export interface SceneTimelineCardProps {
  brief: Pick<Brief, 'hook' | 'beats' | 'captionLanguages'>;
  master: MakeAsset | null;
}

/** Read-only scene timeline from the brief beats (Figma 241:1114). */
export function SceneTimelineCard({ brief, master }: SceneTimelineCardProps) {
  const timeline = buildSceneTimeline(brief, master);
  const seconds = Math.round(timeline.durationMs / 1000);
  return (
    <Panel
      title={
        <span className="text-base">
          Scene timeline · {seconds} s
          {timeline.estimated ? (
            <span className="ml-2 text-xs font-medium text-muted">estimated</span>
          ) : null}
        </span>
      }
    >
      <ul className="flex flex-col gap-3" aria-label="Scene timeline lanes">
        {timeline.lanes.map((lane) => (
          <li key={lane.key} className="flex items-center gap-3">
            <span className="w-[70px] shrink-0 text-xs font-semibold text-muted">{lane.label}</span>
            <div className="relative h-[30px] min-w-0 flex-1 overflow-hidden rounded-md bg-surface-base">
              {lane.segments.map((seg) => (
                <div
                  key={seg.key}
                  title={
                    seg.detail ??
                    `${seg.label} · ${formatTimecode(seg.startMs)} to ${formatTimecode(seg.endMs)}`
                  }
                  aria-label={`${lane.label}: ${seg.label}, ${formatTimecode(seg.startMs)} to ${formatTimecode(seg.endMs)}`}
                  role="img"
                  className={cn(
                    'absolute top-0 h-[30px] overflow-hidden rounded-sm',
                    toneClass[seg.tone],
                  )}
                  style={{ left: `${seg.start * 100}%`, width: `${seg.width * 100}%` }}
                >
                  <span className="absolute left-2 top-2 whitespace-nowrap text-[10px] font-semibold leading-[1.4] text-ink">
                    {seg.label}
                  </span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
