import { Check, Question, X } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import type { ApprovalListItem, BriefClaim } from '@growth-desk/contract';
import { Button, Icon } from '@/components/atoms';
import { ErrorState, errorMessage } from '@/components/molecules';
import { Panel } from '@/components/organisms';
import { Skeleton } from '@/components/ui/skeleton';
import { useApproval, useDecideApproval } from '../api';
import { GATE_NAMES } from '../format';
import { GateChip } from './GateChip';
import { NoteDialog } from './NoteDialog';

const CHECK_VIEW: Record<
  BriefClaim['check'],
  { icon: typeof Check; text: string; className: string }
> = {
  matches: { icon: Check, text: 'Matches', className: 'text-care-text' },
  mismatch: { icon: X, text: 'Does not match', className: 'text-danger-text' },
  unchecked: { icon: Question, text: 'Not checked', className: 'text-muted' },
};

export interface ApprovalDetailPanelProps {
  /** The approval to show (first gate of the selected piece). */
  approvalId: string;
  /** Gates of this piece the signed-in user may decide now. */
  decidable: readonly ApprovalListItem[];
}

/** "REEL-031 · claims in this piece" (Figma 241:1478): claims table, gate chips, decision. */
export function ApprovalDetailPanel({ approvalId, decidable }: ApprovalDetailPanelProps) {
  const detail = useApproval(approvalId);
  const decide = useDecideApproval();
  const [changesFor, setChangesFor] = React.useState<ApprovalListItem | null>(null);
  const decidableIds = React.useMemo(() => new Set(decidable.map((d) => d.id)), [decidable]);

  if (detail.isError) {
    return (
      <ErrorState error={detail.error} onRetry={() => void detail.refetch()} className="flex-1" />
    );
  }
  if (!detail.data) {
    return (
      <Panel className="flex-1" aria-busy="true">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-10 w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </Panel>
    );
  }

  const d = detail.data;
  const slaHours = Math.max(
    1,
    Math.round((new Date(d.dueAt).getTime() - new Date(d.requestedAt).getTime()) / 3_600_000),
  );

  async function approve(item: ApprovalListItem) {
    try {
      const res = await decide.mutateAsync({ id: item.id, decision: 'approved' });
      toast.success(`${GATE_NAMES[item.gate]} approved`, {
        description:
          res.brief.stage === 'approved'
            ? `Both gates are approved. ${res.postsCreated} draft posts are ready on Publish.`
            : 'Waiting for the other gate.',
      });
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
      void detail.refetch();
    }
  }

  return (
    <Panel
      className="min-w-0 flex-1"
      title={`${d.brief.code} · claims in this piece`}
      description={d.brief.title}
    >
      {d.stale ? (
        <p role="status" className="rounded-tile bg-surface-sunken px-3.5 py-2.5 text-13 text-ink">
          This request is for an older version of the brief. It no longer counts.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-left">
          <caption className="sr-only">
            Claims in {d.brief.code}, with their source and check
          </caption>
          <thead>
            <tr className="text-2xs font-semibold tracking-[0.08em] text-muted">
              <th
                scope="col"
                className="rounded-l-[10px] bg-surface-sunken px-3 py-2.5 font-semibold"
              >
                CLAIM
              </th>
              <th scope="col" className="w-[140px] bg-surface-sunken px-3 py-2.5 font-semibold">
                SOURCE
              </th>
              <th
                scope="col"
                className="w-[180px] rounded-r-[10px] bg-surface-sunken px-3 py-2.5 font-semibold"
              >
                CHECK
              </th>
            </tr>
          </thead>
          <tbody>
            {d.claims.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-13 text-muted">
                  The brief lists no claims. Check the hook, beats and ask in the brief.
                </td>
              </tr>
            ) : (
              d.claims.map((c, i) => {
                const v = CHECK_VIEW[c.check];
                return (
                  <tr key={`${c.text}-${i}`}>
                    <td className="px-3 py-2 text-13 text-ink">{c.text}</td>
                    <td className="px-3 py-2 text-13 font-medium text-muted">{c.source}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${v.className}`}
                      >
                        <Icon icon={v.icon} size={14} />
                        {v.text}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {d.claimFlags.some((f) => f.status !== 'pass') ? (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Claim check notes">
          {d.claimFlags
            .filter((f) => f.status !== 'pass')
            .map((f, i) => (
              <li key={i} className={f.status === 'fail' ? 'text-danger-text' : 'text-joy-text'}>
                {f.message}
              </li>
            ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {[...d.gates]
          .sort((a, b) => (a.gate === 'brand' ? -1 : 1) - (b.gate === 'brand' ? -1 : 1))
          .map((g) => (
            <GateChip key={g.id} approval={g} decidableIds={decidableIds} />
          ))}
      </div>

      <p className="text-13 text-muted">
        Approving moves it to the library and schedules it. Request changes sends it back to the
        brief with your note. No reply in {slaHours} h goes to the named backup.
      </p>

      {decidable.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {decidable.map((item) => (
            <Button
              key={item.id}
              variant="primary"
              loading={
                decide.isPending &&
                decide.variables?.id === item.id &&
                decide.variables.decision === 'approved'
              }
              disabled={decide.isPending}
              onClick={() => void approve(item)}
            >
              Approve {item.gate}
            </Button>
          ))}
          <Button
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => setChangesFor(decidable[0]!)}
          >
            Request changes
          </Button>
        </div>
      ) : (
        <p className="text-13 font-semibold text-ink">
          {d.stale
            ? 'Nothing to decide here.'
            : 'You are not the named approver for an open gate on this piece.'}
        </p>
      )}

      {d.history.some((h) => h.decision !== 'pending') ? (
        <details className="rounded-tile border border-hairline px-3.5 py-2.5 text-13">
          <summary className="focus-ring cursor-pointer font-semibold text-ink">
            Decision log
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {d.history
              .filter((h) => h.decision !== 'pending')
              .map((h) => (
                <li key={h.id} className="text-muted">
                  v{h.version} · {GATE_NAMES[h.gate]} ·{' '}
                  {h.decision === 'approved' ? 'approved' : 'changes requested'} by{' '}
                  {h.decidedBy?.name ?? 'unknown'}
                  {h.decidedAt ? ` on ${new Date(h.decidedAt).toLocaleString()}` : ''}
                  {h.note ? `: ${h.note}` : ''}
                </li>
              ))}
          </ul>
        </details>
      ) : null}

      <NoteDialog
        open={changesFor !== null}
        onOpenChange={(open) => (open ? undefined : setChangesFor(null))}
        title={`Request changes on ${d.brief.code}`}
        description="The brief goes back to the maker with your note. Its version goes up, so the other gate starts again."
        confirmLabel="Request changes"
        onSubmit={async (note) => {
          if (!changesFor) return;
          await decide.mutateAsync({ id: changesFor.id, decision: 'changes_requested', note });
          toast.success('Changes requested', { description: 'The maker has your note.' });
        }}
      />
    </Panel>
  );
}
