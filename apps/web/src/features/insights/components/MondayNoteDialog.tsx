/**
 * "Open the Monday note" dialog: the latest note (one thing to do more of, one to stop) and,
 * for owners and editors, "Write this week's note".
 */
import { ArrowsClockwise, Sparkle } from '@phosphor-icons/react';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { Kicker } from '@/components/atoms/Kicker';
import { ErrorState } from '@/components/molecules/ErrorState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useGenerateNote, useLatestNote } from '../api';
import { longDate } from '../format';
import { useCanManageProduct } from '../permissions';

export interface MondayNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  productName?: string | undefined;
}

export function MondayNoteDialog({
  open,
  onOpenChange,
  productId,
  productName,
}: MondayNoteDialogProps) {
  const query = useLatestNote(productId, open);
  const generate = useGenerateNote();
  const canWrite = useCanManageProduct(productId) && productId !== null;
  const note = query.data?.note ?? null;
  const isEcosystem = query.data?.isEcosystem ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={Sparkle} size={20} className="text-joy" />
            Monday note
          </DialogTitle>
          <DialogDescription>
            {note
              ? `Week of ${longDate(note.weekStart)}${isEcosystem ? ' · whole ecosystem' : productName ? ` · ${productName}` : ''}`
              : 'One thing to do more of and one to stop, from last week’s numbers.'}
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState
            error={query.error}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        ) : note ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">{note.body}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-tile bg-care-soft p-4">
                <Kicker tone="care">Do more of</Kicker>
                <p className="text-sm font-medium text-ink">{note.doMore ?? 'Not set'}</p>
              </div>
              <div className="flex flex-col gap-1 rounded-tile bg-joy-soft p-4">
                <Kicker tone="joy">Stop</Kicker>
                <p className="text-sm font-medium text-ink">{note.stopDoing ?? 'Not set'}</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No note has been written yet.</p>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canWrite ? (
            <Button
              variant="dark"
              leftIcon={ArrowsClockwise}
              loading={generate.isPending}
              onClick={() =>
                productId &&
                generate.mutate({ productId, regenerate: Boolean(note && !isEcosystem) })
              }
            >
              {note && !isEcosystem ? 'Write it again' : 'Write this week’s note'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
