import { ArrowSquareOut, Copy, Warning } from '@phosphor-icons/react';
import type { MemoryMatch } from '@growth-desk/contract';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/atoms/Icon';
import { cn } from '@/lib/utils';
import { LAYER_LABELS, SOURCE_LABELS, matchHref } from '../memory';

export interface MemoryMatchesProps {
  status: 'duplicate' | 'similar';
  matches: readonly MemoryMatch[];
  /** What is being saved, for the message ("idea", "brief", "hook"). */
  what?: string;
  /** Replaces the default second line (for example when "similar" only warns). */
  note?: string;
  className?: string;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/**
 * The earlier pieces a new idea, brief or hook repeats (content memory). Duplicate is a hard
 * stop; similar asks for a reason in the form around it.
 */
export function MemoryMatches({ status, matches, what = 'idea', note, className }: MemoryMatchesProps) {
  const duplicate = status === 'duplicate';
  return (
    <div
      role={duplicate ? 'alert' : 'status'}
      className={cn(
        'flex flex-col gap-2 rounded-tile border p-3.5 text-13',
        duplicate ? 'border-danger bg-danger-soft text-danger-text' : 'border-joy bg-joy-soft text-joy-text',
        className,
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <Icon icon={duplicate ? Copy : Warning} size={16} />
        {duplicate ? 'Already used' : `Close to an earlier ${what}`}
      </p>
      <p>
        {note ??
          (duplicate
            ? `Every ${what} must be new, for every product, forever. Change it so it says something new.`
            : `Change it, or say why it is different in "Use anyway, because...".`)}
      </p>
      {matches.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Earlier pieces">
          {matches.map((m) => {
            const href = matchHref(m);
            const meta = [SOURCE_LABELS[m.sourceType], m.productName, formatDate(m.createdAt)].filter(Boolean).join(' · ');
            return (
              <li key={m.id} className="flex flex-col rounded-[10px] bg-surface-card px-3 py-2 text-ink">
                <span className="font-semibold [overflow-wrap:anywhere]">
                  {href ? (
                    <Link to={href} className="focus-ring inline-flex items-center gap-1 rounded-sm hover:underline">
                      {m.title}
                      <ArrowSquareOut size={12} aria-label="Open" />
                    </Link>
                  ) : (
                    m.title
                  )}
                </span>
                <span className="text-2xs text-muted">
                  {meta} · {Math.round(m.score * 100)}% {LAYER_LABELS[m.layer]}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
