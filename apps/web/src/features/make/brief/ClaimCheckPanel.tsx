import { Check, Warning, WarningCircle } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import type { ClaimFlag } from '@growth-desk/contract';
import { Icon } from '@/components/atoms/Icon';
import { Spinner } from '@/components/atoms/Spinner';
import { DURATION, EASE } from '@/components/motion';
import { Panel } from '@/components/organisms/Panel';
import { cn } from '@/lib/utils';

export interface ClaimCheckPanelProps {
  flags: ClaimFlag[];
  checking?: boolean;
  /** Shown when the live check could not run (the stored flags stay on screen). */
  failed?: boolean;
  className?: string;
}

const statusLabel: Record<ClaimFlag['status'], string> = {
  pass: 'Passed',
  warn: 'Check this',
  fail: 'Blocks freeze',
};

/** Stable keys so a flag that stays keeps its row, and a new or changed flag animates in. */
function flagKeys(flags: ClaimFlag[]): string[] {
  const seen = new Map<string, number>();
  return flags.map((f) => {
    const base = `${f.rule}|${f.status}|${f.message}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

const rowMotion = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE } },
  transition: { duration: DURATION.base, ease: EASE },
} as const;

/**
 * Figma 240:1467: 16px title, one row per rule (16px icon, 10px gap, 13px text, 12px between rows).
 * A passing rule shows a check; a warning or a failure shows the warning icon with alert red text.
 * Flags ease in and out as the live check answers while the user types.
 */
export function ClaimCheckPanel({
  flags,
  checking = false,
  failed = false,
  className,
}: ClaimCheckPanelProps) {
  const keys = flagKeys(flags);
  return (
    <Panel
      title="Claim check"
      titleSize="sm"
      className={className}
      actions={checking ? <Spinner size={16} label="Checking" /> : null}
      aria-live="polite"
    >
      {flags.length === 0 ? (
        <p className="text-13 text-muted">Start writing. The check runs as you type.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false} mode="popLayout">
            {flags.map((flag, i) => (
              <motion.li
                key={keys[i]}
                layout="position"
                {...rowMotion}
                className="flex items-start gap-2.5"
                data-status={flag.status}
              >
                <Icon
                  icon={
                    flag.status === 'pass'
                      ? Check
                      : flag.status === 'fail'
                        ? WarningCircle
                        : Warning
                  }
                  size={16}
                  label={statusLabel[flag.status]}
                  className={cn(
                    'mt-0.5 shrink-0',
                    flag.status === 'pass' ? 'text-care' : 'text-danger',
                  )}
                />
                <p
                  className={cn(
                    'min-w-0 flex-1 text-13',
                    flag.status === 'pass' ? 'text-ink' : 'text-danger',
                    flag.status === 'fail' && 'font-medium',
                  )}
                >
                  {flag.message}
                  {flag.suggestion ? (
                    <span className={cn(flag.status === 'pass' && 'text-muted')}>
                      {' '}
                      Suggest: {flag.suggestion}
                    </span>
                  ) : null}
                </p>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {failed ? (
        <p className="text-xs text-muted">
          The live check is not available right now. Showing the last saved result.
        </p>
      ) : null}
    </Panel>
  );
}
