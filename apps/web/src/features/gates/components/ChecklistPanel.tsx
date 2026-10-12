import { Check, Warning } from '@phosphor-icons/react';
import type { ChecklistKey, ReviewChecklistView } from '@growth-desk/contract';
import { Icon } from '@/components/atoms';
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

/** "Checklist · 7 of 8" (Figma 241:1300). Auto items show a check or a warning and cannot be ticked. */
export function ChecklistPanel({ checklist, editable, onTick, pendingKey }: ChecklistPanelProps) {
  return (
    <Panel title={`Checklist · ${checklist.done} of ${checklist.total}`} className="w-full">
      <ul className="flex flex-col gap-3" aria-label="Review checklist">
        {checklist.items.map((item) => {
          const key = item.key as ChecklistKey;
          const id = `check-${item.key}`;
          const text = (
            <span className="flex min-w-0 flex-col">
              <span
                className={cn('text-sm', item.auto && !item.done ? 'text-danger-text' : 'text-ink')}
              >
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
                  <span className="mt-0.5 inline-flex size-5 items-center justify-center">
                    <Icon
                      icon={item.done ? Check : Warning}
                      size={16}
                      label={item.done ? 'Passed' : 'Not passed'}
                      className={item.done ? 'text-care-text' : 'text-danger-text'}
                    />
                  </span>
                  {text}
                  <span className="ml-auto shrink-0 rounded-pill bg-surface-sunken px-2 py-0.5 text-2xs font-semibold text-muted">
                    Auto
                  </span>
                </>
              ) : (
                <>
                  <Checkbox
                    id={id}
                    checked={item.done}
                    disabled={!editable || pendingKey === key}
                    onCheckedChange={(v) => onTick(key, v === true)}
                    className="mt-0.5"
                  />
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
