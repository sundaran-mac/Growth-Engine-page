import { BRIEF_STAGE_LABELS, BRIEF_STAGES, type BriefStage } from '@growth-desk/contract';
import { motion } from 'motion/react';
import { DURATION, EASE } from '@/components/motion';
import { cn } from '@/lib/utils';
import { stageIndex } from './labels';

/**
 * Figma 240:1413: eight stage pills; done and current stages are joy orange.
 * The current pill carries a ring that slides to the next stage when the brief moves on
 * (shared layoutId), so a freeze or a send reads as one step forward.
 */
export function StageTracker({ stage, className }: { stage: BriefStage; className?: string }) {
  const current = stageIndex(stage);
  return (
    <ol aria-label="Brief stage" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {BRIEF_STAGES.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? 'step' : undefined}
          className={cn(
            'relative rounded-pill px-2.5 py-1 text-2xs font-semibold uppercase leading-[1.4] transition-colors duration-200',
            i < current
              ? 'bg-joy text-ink'
              : i === current
                ? 'text-ink'
                : 'bg-surface-card text-muted',
          )}
        >
          {i === current ? (
            <motion.span
              layoutId="brief-stage-active"
              aria-hidden="true"
              className="absolute inset-0 rounded-pill bg-joy"
              transition={{ duration: DURATION.slow, ease: EASE }}
            />
          ) : null}
          <span className="relative">{BRIEF_STAGE_LABELS[s]}</span>
          {i < current ? <span className="sr-only"> (done)</span> : null}
          {i === current ? <span className="sr-only"> (current)</span> : null}
        </li>
      ))}
    </ol>
  );
}
