import { Check, Warning, WarningCircle } from '@phosphor-icons/react';
import type { ClaimFlag } from '@growth-desk/contract';
import { Icon } from '@/components/atoms/Icon';
import { Spinner } from '@/components/atoms/Spinner';
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

/** Figma 240:1467: one row per rule, check icon when it passes, warning with red text when not. */
export function ClaimCheckPanel({ flags, checking = false, failed = false, className }: ClaimCheckPanelProps) {
  return (
    <Panel
      title="Claim check"
      className={className}
      actions={checking ? <Spinner size={16} label="Checking" /> : null}
      aria-live="polite"
    >
      {flags.length === 0 ? (
        <p className="text-13 text-muted">Start writing. The check runs as you type.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {flags.map((flag, i) => (
            <li key={`${flag.rule}-${i}`} className="flex items-start gap-2.5" data-status={flag.status}>
              <Icon
                icon={flag.status === 'pass' ? Check : flag.status === 'fail' ? WarningCircle : Warning}
                size={16}
                label={statusLabel[flag.status]}
                className={cn(
                  'mt-0.5',
                  flag.status === 'pass' && 'text-care',
                  flag.status === 'warn' && 'text-joy-text',
                  flag.status === 'fail' && 'text-danger-text',
                )}
              />
              <p
                className={cn(
                  'min-w-0 flex-1 text-13',
                  flag.status === 'pass' && 'text-ink',
                  flag.status === 'warn' && 'text-joy-text',
                  flag.status === 'fail' && 'font-medium text-danger-text',
                )}
              >
                {flag.message}
                {flag.suggestion ? (
                  <span className={cn(flag.status === 'pass' && 'text-muted')}> Suggest: {flag.suggestion}</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
      {failed ? <p className="text-xs text-muted">The live check is not available right now. Showing the last saved result.</p> : null}
    </Panel>
  );
}
