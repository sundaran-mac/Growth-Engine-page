import { ArrowCounterClockwise, DotsThree, FileText, Pause, Sparkle, Star, Trash } from '@phosphor-icons/react';
import type { Idea } from '@growth-desk/contract';
import { CONTENT_MODE_LABELS } from '@growth-desk/contract';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/atoms/Icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { MODE_CHIP_CLASS } from '../lib';

export interface IdeaCardActions {
  onStar?: (idea: Idea, starred: boolean) => void;
  onPark?: (idea: Idea) => void;
  onUnpark?: (idea: Idea) => void;
  onOpenBrief?: (idea: Idea) => void;
  onDelete?: (idea: Idea) => void;
}

export interface IdeaCardProps extends IdeaCardActions {
  idea: Idea;
  canWrite: boolean;
  canDelete: boolean;
  busy?: boolean;
}

/** Idea card from Figma 240:965: title, mode chip, then fit score, brief code or note. */
export function IdeaCard({ idea, canWrite, canDelete, busy = false, onStar, onPark, onUnpark, onOpenBrief, onDelete }: IdeaCardProps) {
  const footer =
    idea.status === 'briefed' && idea.briefCode
      ? idea.briefCode
      : idea.note
        ? idea.note
        : idea.fitScore !== null
          ? `Fit ${idea.fitScore}`
          : idea.source === 'human'
            ? 'Added by hand'
            : 'No score';
  const stale = idea.note?.startsWith('Stale: ') ?? false;
  const showMenu = (canWrite && idea.status !== 'briefed') || (canDelete && idea.status !== 'briefed');

  return (
    <article
      aria-busy={busy || undefined}
      className={cn(
        'group relative flex w-full flex-col items-start gap-2 rounded-[14px] border border-hairline bg-surface-card p-3.5 transition-shadow',
        busy && 'opacity-60',
      )}
    >
      <div className="w-full">
        <h3 className="min-w-0 text-13 font-semibold text-ink [overflow-wrap:anywhere]" title={idea.summary ?? undefined}>
          {idea.status === 'briefed' && idea.briefId ? (
            <Link to={`/briefs/${idea.briefId}`} className="focus-ring rounded-sm hover:underline">
              {idea.title}
            </Link>
          ) : (
            idea.title
          )}
        </h3>
        {showMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${idea.title}`}
              className={cn(
                'focus-ring absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-pill bg-surface-card text-muted transition-opacity hover:bg-surface-sunken hover:text-ink',
                // Figma shows the card without a menu; it appears on hover, keyboard focus, touch screens, or while open.
                'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
              )}
            >
              <DotsThree size={18} weight="bold" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canWrite && idea.status === 'new' ? (
                <DropdownMenuItem onSelect={() => onStar?.(idea, true)}>
                  <Icon icon={Star} size={16} /> Star
                </DropdownMenuItem>
              ) : null}
              {canWrite && idea.status === 'starred' ? (
                <DropdownMenuItem onSelect={() => onStar?.(idea, false)}>
                  <Icon icon={Star} size={16} /> Unstar
                </DropdownMenuItem>
              ) : null}
              {canWrite && (idea.status === 'new' || idea.status === 'starred') ? (
                <DropdownMenuItem onSelect={() => onOpenBrief?.(idea)}>
                  <Icon icon={FileText} size={16} /> Open as brief
                </DropdownMenuItem>
              ) : null}
              {canWrite && (idea.status === 'new' || idea.status === 'starred') ? (
                <DropdownMenuItem onSelect={() => onPark?.(idea)}>
                  <Icon icon={Pause} size={16} /> Park
                </DropdownMenuItem>
              ) : null}
              {canWrite && idea.status === 'parked' ? (
                <DropdownMenuItem onSelect={() => onUnpark?.(idea)}>
                  <Icon icon={ArrowCounterClockwise} size={16} /> Bring back
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => onDelete?.(idea)}>
                    <Icon icon={Trash} size={16} /> Delete
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <span className={cn('inline-flex whitespace-nowrap rounded-pill px-2.5 py-1 text-2xs font-semibold', MODE_CHIP_CLASS[idea.mode])}>
        {idea.mode} · {CONTENT_MODE_LABELS[idea.mode]}
      </span>
      {idea.angle ? (
        <p className="text-2xs text-muted [overflow-wrap:anywhere]">
          <span className="font-semibold text-ink">Angle</span> {idea.angle}
        </p>
      ) : null}
      <p className={cn('flex items-center gap-1.5 text-2xs font-medium', stale ? 'text-danger-text' : 'text-muted')}>
        <Icon icon={Sparkle} size={12} className={stale ? 'text-danger' : 'text-joy'} />
        <span className="[overflow-wrap:anywhere]">{footer}</span>
      </p>
    </article>
  );
}
