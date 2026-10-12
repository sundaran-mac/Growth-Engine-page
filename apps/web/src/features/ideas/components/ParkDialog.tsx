import * as React from 'react';
import { PARK_REASON_MAX, type Idea } from '@growth-desk/contract';
import { Textarea } from '@/components/atoms/Input';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { Field } from '@/components/molecules/Field';

export interface ParkDialogProps {
  idea: Idea | null;
  onOpenChange: (open: boolean) => void;
  /** Rejects to keep the dialog open. */
  onPark: (idea: Idea, reason: string) => Promise<unknown>;
}

/** Park an idea with a short reason ("Needs a new cast"). The reason shows on the card. Key it by idea id so it starts empty. */
export function ParkDialog({ idea, onOpenChange, onPark }: ParkDialogProps) {
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | undefined>();

  return (
    <ConfirmDialog
      open={idea !== null}
      onOpenChange={onOpenChange}
      title="Park this idea"
      description={idea ? `“${idea.title}” moves to Parked. You can bring it back later.` : undefined}
      confirmLabel="Park idea"
      onConfirm={async () => {
        const text = reason.trim();
        if (!text) {
          setError('Say why, in a few words');
          throw new Error('reason required');
        }
        if (idea) await onPark(idea, text);
      }}
    >
      <Field label="Reason" required error={error} hint="Shown on the card, for example “Needs a new cast”.">
        <Textarea
          rows={2}
          maxLength={PARK_REASON_MAX}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(undefined);
          }}
        />
      </Field>
    </ConfirmDialog>
  );
}
