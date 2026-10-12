import { AnimatePresence, motion } from 'motion/react';
import { DURATION, EASE } from '@/components/motion';
import { cn } from '@/lib/utils';
import { formatWaiting, type ApprovalGroup } from '../format';

export interface ApprovalQueueProps {
  groups: readonly ApprovalGroup[];
  selectedBriefId: string | null;
  onSelect: (group: ApprovalGroup) => void;
}

/**
 * Queue cards (Figma 241:1460): "REEL-031 · title", chip "Live · claims", "waiting 6 h".
 * Cards ease in one after another on load; a decided card slides out and the rest close the gap.
 */
export function ApprovalQueue({ groups, selectedBriefId, onSelect }: ApprovalQueueProps) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Pieces waiting for approval">
      <AnimatePresence mode="popLayout">
        {groups.map((g, i) => {
          const selected = g.brief.id === selectedBriefId;
          return (
            <motion.li
              key={g.brief.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: { duration: DURATION.base, ease: EASE, delay: Math.min(i, 8) * 0.04 },
              }}
              exit={{ opacity: 0, x: -16, transition: { duration: DURATION.base, ease: EASE } }}
              transition={{ duration: DURATION.base, ease: EASE }}
            >
              <motion.button
                type="button"
                onClick={() => onSelect(g)}
                aria-current={selected ? 'true' : undefined}
                whileHover={selected ? undefined : { y: -2 }}
                transition={{ duration: DURATION.fast, ease: EASE }}
                className={cn(
                  'focus-ring flex w-full flex-col items-start gap-1.5 rounded-card text-left transition-[background-color,border-color,box-shadow] duration-200',
                  selected
                    ? 'border-2 border-joy bg-joy-soft p-4'
                    : 'border border-hairline bg-surface-card p-4 hover:shadow-[0_8px_24px_-12px_rgba(26,23,20,0.18)]',
                )}
              >
                <span className="text-sm font-semibold text-ink">
                  {g.brief.code} · {g.brief.title}
                </span>
                <span className="flex items-center gap-2">
                  <span className="rounded-pill bg-surface-card px-2.5 py-1 text-2xs font-semibold text-ink">
                    {g.brief.productShortName} · {g.gatesText}
                  </span>
                  <span className="text-xs text-muted">waiting {formatWaiting(g.requestedAt)}</span>
                  {g.escalated ? (
                    <span className="text-xs font-semibold text-joy-text">backup</span>
                  ) : null}
                </span>
              </motion.button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
