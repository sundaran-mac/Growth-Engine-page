import * as React from 'react';
import { Button, Textarea } from '@/components/atoms';
import { Field } from '@/components/molecules';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isApiError } from '@/lib/api';

export interface NoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  /** Resolves when done; a thrown ApiError shows under the field. */
  onSubmit: (note: string) => Promise<unknown>;
  maxLength?: number;
}

/** Dialog with a required note (send back to the brief, request changes). */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onSubmit,
  maxLength = 2000,
}: NoteDialogProps) {
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);

  // Start clean every time the dialog closes.
  function setOpen(next: boolean) {
    if (!next) {
      setNote('');
      setError(undefined);
    }
    onOpenChange(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = note.trim();
    if (!text) {
      setError('Write a note so the maker knows what to change.');
      return;
    }
    setBusy(true);
    try {
      await onSubmit(text);
      setOpen(false);
    } catch (err) {
      setError(
        isApiError(err)
          ? (err.errors[0]?.message ?? err.detail ?? err.title)
          : 'Something went wrong. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : setOpen(next))}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field label="Note" required error={error} hint={`${note.length} / ${maxLength}`}>
            <Textarea
              value={note}
              maxLength={maxLength}
              rows={4}
              autoFocus
              onChange={(e) => {
                setNote(e.target.value);
                if (error) setError(undefined);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" variant="dark" loading={busy}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
