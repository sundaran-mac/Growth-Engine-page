import { BRIEF_STAGE_LABELS, BRIEF_STAGES, type BriefStage } from '@growth-desk/contract';
import { cn } from '@/lib/utils';
import { stageIndex } from './labels';

/** Figma 240:1413: eight stage pills; done and current stages are joy orange. */
export function StageTracker({ stage, className }: { stage: BriefStage; className?: string }) {
  const current = stageIndex(stage);
  return (
    <ol aria-label="Brief stage" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {BRIEF_STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'rounded-pill px-2.5 py-1 text-2xs font-semibold uppercase',
            i <= current ? 'bg-joy text-ink' : 'bg-surface-card text-muted',
          )}
        >
          {BRIEF_STAGE_LABELS[s]}
          {i < current ? <span className="sr-only"> (done)</span> : null}
          {i === current ? <span className="sr-only"> (current)</span> : null}
        </li>
      ))}
    </ol>
  );
}
