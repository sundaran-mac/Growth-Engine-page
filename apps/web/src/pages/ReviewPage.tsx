// Review screen (Figma frame 241:1193). Owned by the GATES agent.
import { ArrowLeft, Hourglass } from '@phosphor-icons/react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { BRIEF_STAGE_LABELS, type ChecklistKey } from '@growth-desk/contract';
import { Button, Icon } from '@/components/atoms';
import { EmptyState, ErrorState, errorMessage } from '@/components/molecules';
import { Panel } from '@/components/organisms';
import { Page } from '@/components/templates/Page';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useReview,
  useReviewComments,
  useSendBack,
  useSendForApproval,
  useTickChecklist,
} from '@/features/gates/api';
import { ChecklistPanel } from '@/features/gates/components/ChecklistPanel';
import { CommentsPanel } from '@/features/gates/components/CommentsPanel';
import { GateChip } from '@/features/gates/components/GateChip';
import { NoteDialog } from '@/features/gates/components/NoteDialog';
import { ReviewPreview } from '@/features/gates/components/ReviewPreview';
import { isApiError } from '@/lib/api';

const NO_IDS: ReadonlySet<string> = new Set();

export default function ReviewPage() {
  const { briefId = '' } = useParams();
  const review = useReview(briefId);
  const comments = useReviewComments(briefId);
  const tick = useTickChecklist(briefId);
  const send = useSendForApproval(briefId);
  const sendBack = useSendBack(briefId);
  const [positionMs, setPositionMs] = React.useState(0);
  const [seekTo, setSeekTo] = React.useState<{ ms: number; nonce: number } | null>(null);
  const [backOpen, setBackOpen] = React.useState(false);

  const data = review.data;
  const title = data ? `Review · ${data.brief.code}` : 'Review';

  if (review.isError) {
    const notFound = isApiError(review.error) && review.error.status === 404;
    return (
      <Page title="Review" subtitle="Internal review by the product team">
        {notFound ? (
          <EmptyState
            title="This piece was not found"
            description="It may have been removed, or you are not on its product."
            action={
              <Button asChild variant="secondary">
                <Link to="/review">Back to Review</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            error={review.error}
            onRetry={() => void review.refetch()}
            retrying={review.isFetching}
          />
        )}
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="Review" subtitle="Internal review by the product team">
        <div className="flex flex-col gap-6 lg:flex-row" aria-busy="true">
          <Skeleton className="h-[475px] w-full max-w-[380px] rounded-[24px]" />
          <div className="flex flex-1 flex-col gap-4">
            <Skeleton className="h-72 rounded-card" />
            <Skeleton className="h-48 rounded-card" />
          </div>
        </div>
      </Page>
    );
  }

  const { brief, checklist } = data;
  const inReview = brief.stage === 'made';
  const waiting = brief.stage === 'reviewed';
  const sendBlocked = !data.canSend || !inReview || !checklist.complete;
  const sendHint = !data.canSend
    ? 'Only the owner, backup or maker can send this for approval.'
    : !inReview
      ? `This piece is ${BRIEF_STAGE_LABELS[brief.stage].toLowerCase()}, not in review.`
      : !checklist.complete
        ? `Finish the checklist first (${checklist.done} of ${checklist.total}).`
        : 'Sends it to the product owner and the brand approver.';

  async function onTick(key: ChecklistKey, done: boolean) {
    try {
      await tick.mutateAsync({ version: brief.version, key, done });
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
      if (isApiError(err) && err.status === 409) void review.refetch();
    }
  }

  async function onSend() {
    try {
      await send.mutateAsync(brief.version);
      toast.success('Sent for approval', {
        description: 'The owner and the brand approver are notified.',
      });
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
      void review.refetch();
    }
  }

  const hasTimeline = Boolean(data.master?.mimeType.startsWith('video/'));

  return (
    <Page
      title={title}
      documentTitle={title}
      subtitle="Internal review by the product team"
      actions={
        <>
          <Button asChild variant="ghost" size="sm" leftIcon={ArrowLeft}>
            <Link to="/review">All pieces</Link>
          </Button>
          {data.canSend && (inReview || waiting) ? (
            <Button variant="secondary" onClick={() => setBackOpen(true)}>
              Request changes
            </Button>
          ) : null}
          <span title={sendHint}>
            <Button
              variant="primary"
              onClick={() => void onSend()}
              disabled={sendBlocked}
              loading={send.isPending}
              aria-describedby="send-hint"
            >
              Send for approval
            </Button>
          </span>
          <span id="send-hint" className="sr-only">
            {sendHint}
          </span>
        </>
      }
    >
      {!inReview ? (
        <Panel tone="sunken" className="flex-row items-center gap-3 p-4">
          <Icon icon={Hourglass} size={20} />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="text-sm font-semibold text-ink">
              {waiting ? 'Waiting for approval' : `Stage: ${BRIEF_STAGE_LABELS[brief.stage]}`}
            </p>
            <p className="text-xs text-muted">
              {waiting
                ? 'The checklist is locked. Approvers decide on the Approvals screen.'
                : 'The checklist only changes while a piece is in review.'}
            </p>
          </div>
          {waiting ? (
            <div className="flex flex-wrap gap-2">
              {data.approvals.map((a) => (
                <GateChip key={a.id} approval={a} decidableIds={NO_IDS} />
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <ReviewPreview
          master={data.master}
          caption={brief.hook}
          comments={comments.data?.items ?? []}
          positionMs={positionMs}
          onPositionChange={setPositionMs}
          seekTo={seekTo}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <ChecklistPanel
            checklist={checklist}
            editable={data.canReview && inReview}
            onTick={(k, d) => void onTick(k, d)}
            pendingKey={tick.isPending ? (tick.variables?.key ?? null) : null}
          />
          <CommentsPanel
            briefId={brief.id}
            comments={comments.data?.items}
            isLoading={comments.isPending}
            error={comments.error}
            onRetry={() => void comments.refetch()}
            canComment={data.canReview}
            positionMs={hasTimeline ? positionMs : null}
            onSeek={(ms) => {
              setPositionMs(ms);
              setSeekTo({ ms, nonce: Date.now() });
            }}
          />
        </div>
      </div>

      <NoteDialog
        open={backOpen}
        onOpenChange={setBackOpen}
        title={`Send ${brief.code} back to the brief`}
        description="The brief goes back to the maker with your note. Its version goes up, so any approvals so far stop counting."
        confirmLabel="Send back"
        onSubmit={async (note) => {
          await sendBack.mutateAsync({ version: brief.version, note });
          toast.success('Sent back to the brief');
        }}
      />
    </Page>
  );
}
