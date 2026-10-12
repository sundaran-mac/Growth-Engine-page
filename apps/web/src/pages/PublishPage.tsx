// Publish one brief: every channel row, schedule all, post now, retry. Figma frame 242:1131.
import { ArrowLeft, PaperPlaneTilt } from '@phosphor-icons/react';
import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { BRIEF_STAGE_LABELS, type PostView } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { toast } from '@/components/ui/sonner';
import {
  useBriefPosts,
  useMarkPosted,
  useMediaUrl,
  usePostAction,
  usePublishSummary,
  useScheduleAll,
  useUpdatePost,
} from '@/features/publish/api';
import { BestWindowPanel } from '@/features/publish/BestWindowPanel';
import { EditPostDialog } from '@/features/publish/EditPostDialog';
import { channelLabel } from '@/features/publish/format';
import { GateBanner } from '@/features/publish/GateBanner';
import { PublishRowsTable, type RowAction } from '@/features/publish/PublishRowsTable';
import { toastError } from '@/features/publish/toast';
import { TrackedLinkPanel } from '@/features/publish/TrackedLinkPanel';

const SUBTITLE = 'one master, every channel, each audience’s evening';

export default function PublishPage() {
  const { briefId } = useParams();
  const summary = usePublishSummary(briefId);
  const posts = useBriefPosts(briefId);
  const scheduleAll = useScheduleAll(briefId);
  const postAction = usePostAction(briefId);
  const updatePost = useUpdatePost(briefId);
  const markPosted = useMarkPosted(briefId);
  const mediaUrl = useMediaUrl();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<PostView | null>(null);
  const [cancelling, setCancelling] = React.useState<PostView | null>(null);
  const [marking, setMarking] = React.useState<PostView | null>(null);
  const [liveUrl, setLiveUrl] = React.useState('');
  const [postAllOpen, setPostAllOpen] = React.useState(false);

  const items = posts.data?.items;
  const brief = summary.data?.brief;
  const gateAllowed = summary.data?.gate.allowed ?? false;
  const selected = items?.find((p) => p.id === selectedId) ?? items?.[0] ?? null;
  const postNowRows = (items ?? []).filter(
    (p) => p.how === 'auto' && (p.status === 'draft' || p.status === 'scheduled'),
  );
  const nameOf = (p: PostView) => channelLabel(p.platform, brief?.kind, p.channel.displayName);

  async function runAction(post: PostView, action: 'post-now' | 'retry' | 'cancel') {
    const done = { 'post-now': 'Posting now', retry: 'Retry queued', cancel: 'Back to draft' }[
      action
    ];
    try {
      await postAction.mutateAsync({ postId: post.id, action });
      toast.success(`${done}: ${nameOf(post)}`);
    } catch (error) {
      toastError(error);
      throw error;
    }
  }

  async function download(post: PostView) {
    try {
      const res = await mediaUrl.mutateAsync(post.id);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toastError(error, 'Could not get the file');
    }
  }

  function onAction(post: PostView, action: RowAction) {
    switch (action) {
      case 'edit':
        setEditing(post);
        break;
      case 'cancel':
        setCancelling(post);
        break;
      case 'mark-posted':
        setLiveUrl('');
        setMarking(post);
        break;
      case 'download':
        void download(post);
        break;
      case 'post-now':
      case 'retry':
        void runAction(post, action).catch(() => undefined);
        break;
    }
  }

  async function onScheduleAll() {
    try {
      const res = await scheduleAll.mutateAsync();
      toast.success(res.scheduled === 1 ? '1 post scheduled' : `${res.scheduled} posts scheduled`, {
        ...(res.skipped.length > 0
          ? {
              description: `${res.skipped.length} skipped: ${res.skipped.map((s) => s.reason).join('; ')}`,
            }
          : {}),
      });
    } catch (error) {
      toastError(error, 'Could not schedule');
    }
  }

  async function onPostAllNow() {
    let failed = 0;
    for (const p of postNowRows) {
      try {
        await postAction.mutateAsync({ postId: p.id, action: 'post-now' });
      } catch (error) {
        failed += 1;
        toastError(error, `Could not post to ${nameOf(p)}`);
      }
    }
    if (failed < postNowRows.length)
      toast.success('Posting now. Rows update as each channel answers.');
  }

  if (!briefId) return null;

  const title = brief ? `Publish · ${brief.code}` : 'Publish';
  const subtitle = brief ? `${BRIEF_STAGE_LABELS[brief.stage]} · ${SUBTITLE}` : SUBTITLE;

  if (summary.isError) {
    return (
      <Page title="Publish" subtitle={SUBTITLE}>
        <ErrorState
          error={summary.error}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      </Page>
    );
  }

  return (
    <Page
      title={title}
      documentTitle={title}
      subtitle={subtitle}
      actions={
        <>
          <Button
            variant="secondary"
            disabled={!gateAllowed || postNowRows.length === 0}
            onClick={() => setPostAllOpen(true)}
          >
            Post now
          </Button>
          <Button
            leftIcon={PaperPlaneTilt}
            loading={scheduleAll.isPending}
            disabled={!gateAllowed || !items || items.length === 0}
            onClick={() => void onScheduleAll()}
          >
            Schedule all
          </Button>
        </>
      }
    >
      <Link
        to="/publish"
        className="focus-ring inline-flex w-fit items-center gap-1.5 rounded-sm text-13 font-medium text-muted hover:text-ink"
      >
        <ArrowLeft size={14} aria-hidden="true" /> All pieces
      </Link>

      {summary.data ? <GateBanner gate={summary.data.gate} /> : null}

      <Panel>
        {posts.data && posts.data.items.length === 0 ? (
          <EmptyState
            bordered={false}
            title="No posts yet"
            description="Draft posts are made for every channel when both gates approve this piece."
          />
        ) : (
          <PublishRowsTable
            posts={items}
            briefKind={brief?.kind}
            gateAllowed={gateAllowed}
            loading={posts.isPending}
            error={posts.error}
            onRetryLoad={() => void posts.refetch()}
            selectedId={selected?.id ?? null}
            onSelect={(p) => setSelectedId(p.id)}
            onAction={onAction}
          />
        )}
      </Panel>

      <div className="grid gap-5 md:grid-cols-2">
        <BestWindowPanel summary={summary.data} />
        <TrackedLinkPanel
          postId={selected?.id ?? null}
          channelName={selected ? nameOf(selected) : undefined}
        />
      </div>

      <EditPostDialog
        post={editing}
        briefKind={brief?.kind}
        open={editing !== null}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        onSave={async (body) => {
          if (!editing) return;
          try {
            await updatePost.mutateAsync({ postId: editing.id, body });
            toast.success('Saved');
          } catch (error) {
            toastError(error, 'Could not save');
            throw error;
          }
        }}
      />

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => (open ? undefined : setCancelling(null))}
        title="Cancel this post?"
        description={
          cancelling
            ? `${nameOf(cancelling)} goes back to draft. Nothing is posted until it is scheduled again.`
            : undefined
        }
        confirmLabel="Cancel post"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={() => (cancelling ? runAction(cancelling, 'cancel') : undefined)}
      />

      <ConfirmDialog
        open={marking !== null}
        onOpenChange={(open) => (open ? undefined : setMarking(null))}
        title="Mark as posted?"
        description="Use this after you posted the file by hand. Add the link to the post if you have it."
        confirmLabel="Mark as posted"
        onConfirm={async () => {
          if (!marking) return;
          const url = liveUrl.trim();
          try {
            await markPosted.mutateAsync({ postId: marking.id, body: url ? { liveUrl: url } : {} });
            toast.success(`Marked as posted: ${nameOf(marking)}`);
          } catch (error) {
            toastError(error, 'Could not mark as posted');
            throw error;
          }
        }}
      >
        <Field label="Link to the post (optional)">
          <Input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={liveUrl}
            onChange={(e) => setLiveUrl(e.target.value)}
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={postAllOpen}
        onOpenChange={setPostAllOpen}
        title="Post now on every auto channel?"
        description={`${postNowRows.length} ${postNowRows.length === 1 ? 'row goes' : 'rows go'} out now, not at the planned time. Reminder rows are not touched.`}
        confirmLabel="Post now"
        onConfirm={onPostAllNow}
      />
    </Page>
  );
}
