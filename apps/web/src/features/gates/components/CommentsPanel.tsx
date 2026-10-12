import { ArrowBendUpLeft, CheckCircle, ArrowCounterClockwise } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import { REVIEW_COMMENT_MAX, type ReviewComment } from '@growth-desk/contract';
import { Avatar, Button, StatusChip, Textarea } from '@/components/atoms';
import { EmptyState, ErrorState, errorMessage } from '@/components/molecules';
import { Panel } from '@/components/organisms';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCreateComment, useUpdateComment } from '../api';
import { formatTimecode, toThreads } from '../format';

export interface CommentsPanelProps {
  briefId: string;
  comments: readonly ReviewComment[] | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canComment: boolean;
  /** Current playhead, for "Comment at 0:12". Null when the piece has no timeline. */
  positionMs: number | null;
  onSeek: (ms: number) => void;
}

const nameOf = (c: ReviewComment) => c.authorLabel ?? c.author?.name ?? 'Former member';

function CommentBody({
  comment,
  onSeek,
  size,
}: {
  comment: ReviewComment;
  onSeek?: (ms: number) => void;
  size: 'root' | 'reply';
}) {
  const name = nameOf(comment);
  return (
    <>
      <Avatar
        name={comment.author?.name ?? name}
        initials={comment.author?.initials ?? null}
        size={size === 'reply' ? 'sm' : 'md'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-13 font-semibold text-ink">{name}</span>
          {onSeek && comment.timecodeMs !== null ? (
            <button
              type="button"
              onClick={() => onSeek(comment.timecodeMs!)}
              className="focus-ring rounded-pill bg-joy-soft px-2.5 py-1 text-2xs font-semibold text-joy-text"
              aria-label={`Go to ${formatTimecode(comment.timecodeMs)}`}
            >
              {formatTimecode(comment.timecodeMs)}
            </button>
          ) : null}
          {onSeek && comment.resolved ? <StatusChip tone="success">Resolved</StatusChip> : null}
        </div>
        <p className="whitespace-pre-line break-words text-13 text-muted">{comment.body}</p>
      </div>
    </>
  );
}

function ReplyForm({
  briefId,
  root,
  onDone,
}: {
  briefId: string;
  root: ReviewComment;
  onDone: () => void;
}) {
  const create = useCreateComment(briefId);
  const [body, setBody] = React.useState('');
  const id = React.useId();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    try {
      await create.mutateAsync({ body: text, parentId: root.id });
      toast.success('Reply added');
      onDone();
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <Label htmlFor={id} className="sr-only">
        Reply to {nameOf(root)}
      </Label>
      <Textarea
        id={id}
        value={body}
        rows={2}
        autoFocus
        maxLength={REVIEW_COMMENT_MAX}
        placeholder={`Reply to ${nameOf(root)}`}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === 'Escape') onDone();
        }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={create.isPending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="dark" loading={create.isPending} disabled={!body.trim()}>
          Send reply
        </Button>
      </div>
    </form>
  );
}

/**
 * Comments at timecodes (Figma 241:1334): avatar, name, time chip, body. Replies sit indented
 * under their root comment; Resolve on the root resolves the whole thread.
 */
export function CommentsPanel({
  briefId,
  comments,
  isLoading,
  error,
  onRetry,
  canComment,
  positionMs,
  onSeek,
}: CommentsPanelProps) {
  const create = useCreateComment(briefId);
  const update = useUpdateComment(briefId);
  const [body, setBody] = React.useState('');
  const [atTime, setAtTime] = React.useState(true);
  const [replyTo, setReplyTo] = React.useState<string | null>(null);
  const threads = React.useMemo(() => toThreads(comments ?? []), [comments]);

  const timecode = positionMs !== null && atTime ? positionMs : null;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text) return;
    try {
      await create.mutateAsync({ body: text, timecodeMs: timecode });
      setBody('');
      toast.success('Comment added');
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
    }
  }

  async function toggleResolved(c: ReviewComment) {
    try {
      await update.mutateAsync({ id: c.id, resolved: !c.resolved });
    } catch (err) {
      const m = errorMessage(err);
      toast.error(m.title, { description: m.detail });
    }
  }

  return (
    <Panel title="Comments" className="w-full">
      {error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      ) : threads.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {threads.map(({ root, replies }) => (
            <li
              key={root.id}
              className={cn('flex flex-col gap-2', root.resolved && 'opacity-60')}
              aria-label={`Comment by ${nameOf(root)}${replies.length ? `, ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : ''}`}
            >
              <div className="flex items-start gap-3">
                <CommentBody comment={root} onSeek={onSeek} size="root" />
              </div>
              {replies.length > 0 ? (
                <ul className="ml-12 flex flex-col gap-2 border-l border-hairline pl-3" aria-label="Replies">
                  {replies.map((r) => (
                    <li key={r.id} className="flex items-start gap-2.5">
                      <CommentBody comment={r} size="reply" />
                    </li>
                  ))}
                </ul>
              ) : null}
              {canComment ? (
                <div className="ml-12 flex flex-col gap-2">
                  {replyTo === root.id ? (
                    <ReplyForm briefId={briefId} root={root} onDone={() => setReplyTo(null)} />
                  ) : (
                    <div className="-ml-2 flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={ArrowBendUpLeft}
                        onClick={() => setReplyTo(root.id)}
                        aria-label={`Reply to ${nameOf(root)}`}
                      >
                        Reply
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={root.resolved ? ArrowCounterClockwise : CheckCircle}
                        loading={update.isPending && update.variables?.id === root.id}
                        onClick={() => void toggleResolved(root)}
                      >
                        {root.resolved ? 'Reopen' : 'Resolve'}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          bordered={false}
          className="py-6"
          title="No comments yet"
          description="Watch the preview and comment at a timecode."
        />
      )}

      {canComment ? (
        <form
          onSubmit={(e) => void submit(e)}
          className="flex flex-col gap-2 border-t border-hairline pt-4"
        >
          <Label htmlFor="review-comment" className="sr-only">
            New comment
          </Label>
          <Textarea
            id="review-comment"
            value={body}
            rows={2}
            maxLength={REVIEW_COMMENT_MAX}
            placeholder="Write a comment"
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            {positionMs !== null ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="comment-at-time"
                  checked={atTime}
                  onCheckedChange={(v) => setAtTime(v === true)}
                />
                <Label htmlFor="comment-at-time" className="text-xs font-normal text-muted">
                  At {formatTimecode(positionMs)}
                </Label>
              </div>
            ) : null}
            <Button
              type="submit"
              size="sm"
              variant="dark"
              className="ml-auto"
              loading={create.isPending}
              disabled={!body.trim()}
            >
              {timecode !== null ? `Comment at ${formatTimecode(timecode)}` : 'Comment'}
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
