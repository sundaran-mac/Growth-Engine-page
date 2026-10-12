// Approvals screen (Figma frame 241:1363). Owned by the GATES agent.
import { SealCheck } from '@phosphor-icons/react';
import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState } from '@/components/molecules';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import { useApprovalQueue } from '@/features/gates/api';
import { ApprovalDetailPanel } from '@/features/gates/components/ApprovalDetailPanel';
import { ApprovalQueue } from '@/features/gates/components/ApprovalQueue';
import { groupByBrief } from '@/features/gates/format';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';

type Scope = 'mine' | 'all';

export default function ApprovalsPage() {
  const role = useSessionStore((s) => s.user?.role);
  const canSeeAll = role === 'admin' || role === 'editor';
  const [params, setParams] = useSearchParams();
  const scope: Scope = canSeeAll && params.get('scope') === 'all' ? 'all' : 'mine';
  const queue = useApprovalQueue(scope);
  const groups = React.useMemo(() => groupByBrief(queue.data?.items ?? []), [queue.data]);

  // `?id=<approvalId>` comes from notifications; otherwise select the oldest piece.
  const wantedId = params.get('id');
  const selected = groups.find((g) => g.items.some((i) => i.id === wantedId)) ?? groups[0] ?? null;
  const selectedId = selected
    ? (selected.items.find((i) => i.id === wantedId) ?? selected.items[0]!).id
    : (wantedId ?? null);
  const decidable = selected ? selected.items.filter((i) => i.canDecide) : [];

  function setScope(next: Scope) {
    const p = new URLSearchParams(params);
    if (next === 'all') p.set('scope', 'all');
    else p.delete('scope');
    p.delete('id');
    setParams(p, { replace: true });
  }

  return (
    <Page
      title="Approvals"
      subtitle="Two gates: the product owner confirms it is true, Elan confirms it is on-brand"
    >
      {canSeeAll ? (
        <div role="group" aria-label="Which approvals" className="flex gap-2">
          {(['mine', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={cn(
                'focus-ring rounded-pill px-3.5 py-1.5 text-13 font-semibold',
                scope === s
                  ? 'bg-media-canvas text-media-text'
                  : 'border border-hairline bg-surface-card text-ink',
              )}
            >
              {s === 'mine' ? 'Waiting for me' : 'All pending'}
            </button>
          ))}
        </div>
      ) : null}

      {queue.isError ? (
        <ErrorState
          error={queue.error}
          onRetry={() => void queue.refetch()}
          retrying={queue.isFetching}
        />
      ) : queue.isPending ? (
        <div className="flex flex-col gap-5 lg:flex-row" aria-busy="true">
          <div className="flex w-full flex-col gap-2.5 lg:w-[360px]">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[82px] rounded-card" />
            ))}
          </div>
          <Skeleton className="h-[330px] flex-1 rounded-card" />
        </div>
      ) : groups.length === 0 && !wantedId ? (
        <EmptyState
          icon={SealCheck}
          title={scope === 'mine' ? 'Nothing waits for you' : 'No pending approvals'}
          description="When a piece is sent for approval and you are its approver, it shows here."
        />
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 lg:w-[360px]">
            {groups.length > 0 ? (
              <ApprovalQueue
                groups={groups}
                selectedBriefId={selected?.brief.id ?? null}
                onSelect={(g) => {
                  const p = new URLSearchParams(params);
                  p.set('id', g.items[0]!.id);
                  setParams(p, { replace: true });
                }}
              />
            ) : (
              <p className="rounded-card border border-hairline bg-surface-card p-4 text-13 text-muted">
                Nothing else waits for you.
              </p>
            )}
          </div>
          {selectedId ? (
            <ApprovalDetailPanel key={selectedId} approvalId={selectedId} decidable={decidable} />
          ) : null}
        </div>
      )}
    </Page>
  );
}
