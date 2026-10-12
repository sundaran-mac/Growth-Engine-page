import { Check, Warning } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import type { ChecklistKey, ReviewChecklistView } from '@growth-desk/contract';
import { Icon } from '@/components/atoms';
import { DURATION, EASE } from '@/components/motion';
import { Panel } from '@/components/organisms';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export interface ChecklistPanelProps {
  checklist: ReviewChecklistView;
  /** Manual ticks allowed (reviewer, piece still in review). */
  editable: boolean;
  onTick: (key: ChecklistKey, done: boolean) => void;
  pendingKey?: ChecklistKey | null;
}

/** A tick settles in with a short scale; unticking just returns to rest. */
const TICK_IN = { scale: [0.8, 1], transition: { duration: DURATION.base, ease: EASE } };
const TICK_REST = { scale: 1 };

/**
 * "Checklist · 7 of 8" (Figma 241:1300): 16px title, rows of 16px icon, 10px gap, 14px text,
 * 12px between rows; a failed auto item is alert red with a warning icon.
 * Auto items show a check or a warning and cannot be ticked.
 */
export function ChecklistPanel({ checklist, editable, onTick, pendingKey }: ChecklistPanelProps) {
  return (
    <Panel
      title={`Checklist · ${checklist.done} of ${checklist.total}`}
      titleSize="sm"
      className="w-full"
    >
      <ul className="flex flex-col gap-3" aria-label="Review checklist">
        {checklist.items.map((item) => {
          const key = item.key as ChecklistKey;
          const id = `check-${item.key}`;
          const text = (
            <span className="flex min-w-0 flex-col">
              <span className={cn('text-sm', item.auto && !item.done ? 'text-danger' : 'text-ink')}>
                {item.label}
                {item.key === 'loudness' && item.auto && item.detail ? ` ${item.detail}` : null}
              </span>
              {item.detail && item.key !== 'loudness' ? (
                <span className="text-xs text-muted">{item.detail}</span>
              ) : null}
              {item.key === 'loudness' && !item.auto && item.detail ? (
                <span className="text-xs text-muted">{item.detail}</span>
              ) : null}
            </span>
          );
          return (
            <li key={item.key} className="flex items-start gap-2.5">
              {item.auto ? (
                <>
                  <span className="inline-flex size-5 shrink-0 items-center justify-center">
                    <Icon
                      icon={item.done ? Check : Warning}
                      size={16}
                      label={item.done ? 'Passed' : 'Not passed'}
                      className={item.done ? 'text-care' : 'text-danger'}
                    />
                  </span>
                  {text}
                  <span className="ml-auto shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-2xs font-semibold text-muted">
                    Auto
                  </span>
                </>
              ) : (
                <>
                  <motion.span
                    className="inline-flex shrink-0"
                    initial={false}
                    animate={item.done ? TICK_IN : TICK_REST}
                  >
                    <Checkbox
                      id={id}
                      checked={item.done}
                      disabled={!editable || pendingKey === key}
                      onCheckedChange={(v) => onTick(key, v === true)}
                    />
                  </motion.span>
                  <label htmlFor={id} className={cn('min-w-0', editable && 'cursor-pointer')}>
                    {text}
                  </label>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
