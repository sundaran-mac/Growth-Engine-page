import { Copy } from '@phosphor-icons/react';
import { Button } from '@/components/atoms/Button';
import { Panel } from '@/components/organisms/Panel';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { useTrackedLink } from './api';
import { toastError } from './toast';

export interface TrackedLinkPanelProps {
  postId: string | null;
  /** Channel name of the row the link belongs to. */
  channelName?: string | undefined;
}

/** "Tracked link" card from Figma 242:1131 with a copy button. */
export function TrackedLinkPanel({ postId, channelName }: TrackedLinkPanelProps) {
  const link = useTrackedLink(postId);

  async function copy() {
    if (!link.data) return;
    try {
      await navigator.clipboard.writeText(link.data.url);
      toast.success('Link copied');
    } catch (error) {
      toastError(error, 'Could not copy the link');
    }
  }

  return (
    <Panel
      title={<span className="text-base">Tracked link</span>}
      {...(channelName
        ? { description: `For ${channelName}. Pick another row to see its link.` }
        : {})}
      actions={
        <Button
          variant="secondary"
          size="sm"
          leftIcon={Copy}
          onClick={() => void copy()}
          disabled={!link.data}
        >
          Copy
        </Button>
      }
      className="flex-1"
    >
      <div className="rounded-[10px] bg-surface-sunken px-3.5 py-2.5">
        {!postId ? (
          <p className="text-xs text-muted">No posts yet, so there is no link.</p>
        ) : link.isPending ? (
          <Skeleton className="h-4 w-full" />
        ) : link.isError ? (
          <p className="text-xs text-danger-text" role="alert">
            Could not load the link.{' '}
            <button
              type="button"
              className="focus-ring rounded-sm underline"
              onClick={() => void link.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <p className="break-all text-xs font-medium text-ink" data-testid="tracked-link">
            {link.data.display}
          </p>
        )}
      </div>
      <p className="text-13 text-muted">
        Written into the bio, the description and the keyword reply.
      </p>
    </Panel>
  );
}
