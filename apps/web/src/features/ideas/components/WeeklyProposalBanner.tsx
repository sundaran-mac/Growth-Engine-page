import { ArrowSquareOut, CalendarStar } from '@phosphor-icons/react';
import type { WeeklyProposal } from '@growth-desk/contract';
import { Icon } from '@/components/atoms/Icon';

/** Shown when this week's Monday run drafted ideas for the product. */
export function WeeklyProposalBanner({ proposal }: { proposal: WeeklyProposal }) {
  const ideas = proposal.ideasCreated === 1 ? '1 new idea' : `${proposal.ideasCreated} new ideas`;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-card bg-joy-soft px-5 py-4 text-ink">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-tile bg-joy text-ink">
        <Icon icon={CalendarStar} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Weekly proposal</p>
        <p className="text-13 text-joy-text">
          This Monday Claude drafted {ideas}. Star the ones to make; park the rest.
        </p>
      </div>
      {proposal.githubPrUrl ? (
        <a
          href={proposal.githubPrUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="focus-ring inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-strong bg-surface-card px-4 py-2 text-13 font-semibold text-ink hover:bg-surface-sunken"
        >
          Open the pull request
          <Icon icon={ArrowSquareOut} size={16} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : null}
    </div>
  );
}
