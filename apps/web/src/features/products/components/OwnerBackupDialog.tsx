import * as React from 'react';
import { toast } from 'sonner';
import type { UserRef } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Field } from '@/components/molecules/Field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUpdateProduct } from '../api';
import { toastArgs } from '../format';
import { PersonSelect } from './PersonSelect';

export interface OwnerBackupDialogProps {
  productId: string;
  owner: UserRef | null;
  backup: UserRef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Change the named owner and backup (PATCH /products/:id). Owner or admin only. Mount it when opening. */
export function OwnerBackupDialog({
  productId,
  owner,
  backup,
  open,
  onOpenChange,
}: OwnerBackupDialogProps) {
  const update = useUpdateProduct(productId);
  const [ownerId, setOwnerId] = React.useState<string | null>(owner?.id ?? null);
  const [backupId, setBackupId] = React.useState<string | null>(backup?.id ?? null);

  const same = ownerId !== null && ownerId === backupId;

  async function save() {
    try {
      await update.mutateAsync({ ownerId, backupId });
      toast.success('Owner and backup saved');
      onOpenChange(false);
    } catch (error) {
      toast.error(...toastArgs(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (update.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Owner and backup</DialogTitle>
          <DialogDescription>
            The owner signs the kit and decides the claims gate. The backup decides when the owner
            does not answer in 24 hours.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Owner">
            <PersonSelect value={ownerId} onChange={setOwnerId} noneLabel="To confirm" />
          </Field>
          <Field
            label="Backup"
            error={same ? 'Owner and backup must be different people' : undefined}
          >
            <PersonSelect value={backupId} onChange={setBackupId} noneLabel="To name" />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={update.isPending} disabled={same}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
