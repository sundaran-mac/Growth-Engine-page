import { cn } from '@/lib/utils';
import { formatWaiting, type ApprovalGroup } from '../format';

export interface ApprovalQueueProps {
  groups: readonly ApprovalGroup[];
  selectedBriefId: string | null;
  onSelect: (group: ApprovalGroup) => void;
}

/** Queue cards (Figma 241:1460): "REEL-031 · title", chip "Live · claims", "waiting 6 h". */
export function ApprovalQueue({ groups, selectedBriefId, onSelect }: ApprovalQueueProps) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Pieces waiting for approval">
      {groups.map((g) => {
        const selected = g.brief.id === selectedBriefId;
        return (
          <li key={g.brief.id}>
            <button
              type="button"
              onClick={() => onSelect(g)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'focus-ring flex w-full flex-col items-start gap-1.5 rounded-card p-4 text-left transition-colors',
                selected
                  ? 'border-2 border-joy bg-joy-soft'
                  : 'border border-hairline bg-surface-card hover:bg-surface-sunken/60',
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}
