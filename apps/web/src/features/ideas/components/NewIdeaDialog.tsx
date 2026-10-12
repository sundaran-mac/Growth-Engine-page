import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONTENT_MODES,
  IDEA_SUMMARY_MAX,
  IDEA_TITLE_MAX,
  PLATFORMS,
  PLATFORM_LABELS,
  SIMILAR_REASON_MAX,
  SIMILAR_REASON_MIN,
  contentModeSchema,
  platformSchema,
  type MemoryMatch,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input, Textarea } from '@/components/atoms/Input';
import { errorMessage } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateIdea } from '../api';
import { modeLabel } from '../lib';
import { repeatKind, useMemoryCheck } from '../memory';
import { MemoryMatches } from './MemoryMatches';

const formSchema = z.object({
  title: z.string().trim().min(1, 'Give the idea a title').max(IDEA_TITLE_MAX),
  summary: z.string().trim().max(IDEA_SUMMARY_MAX),
  mode: contentModeSchema,
  channels: z.array(platformSchema),
  similarReason: z.string().trim().max(SIMILAR_REASON_MAX),
});
type FormValues = z.infer<typeof formSchema>;

export interface NewIdeaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
}

interface Repeat {
  status: 'duplicate' | 'similar';
  title: string;
  matches: MemoryMatch[];
}

const EMPTY: FormValues = { title: '', summary: '', mode: 'M1', channels: ['instagram'], similarReason: '' };

/**
 * "New idea" by hand. It lands in the New column with source "human". The content memory checks
 * it against every product: a repeat is refused, a similar one needs "Use anyway, because...".
 */
export function NewIdeaDialog({ open, onOpenChange, productId, productName }: NewIdeaDialogProps) {
  const create = useCreateIdea();
  const check = useMemoryCheck();
  const [lastRepeat, setRepeat] = React.useState<Repeat | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: EMPTY,
  });
  const title = useWatch({ control, name: 'title' });
  // The matches belong to the title that was checked; a changed title needs a new check.
  const repeat = lastRepeat && lastRepeat.title === title.trim() ? lastRepeat : null;

  React.useEffect(() => {
    if (open) reset(EMPTY);
  }, [open, reset]);

  const onSubmit = handleSubmit((values) => {
    const reason = values.similarReason.trim();
    if (repeat?.status === 'similar' && reason.length < SIMILAR_REASON_MIN) {
      setError('similarReason', { message: `Write at least ${SIMILAR_REASON_MIN} characters` });
      return;
    }
    const summary = values.summary || null;
    create.mutate(
      {
        productId,
        title: values.title,
        summary,
        mode: values.mode,
        channels: values.channels,
        ...(repeat?.status === 'similar' ? { similarReason: reason } : {}),
      },
      {
        onSuccess: (idea) => {
          toast.success('Idea added', { description: idea.title });
          onOpenChange(false);
        },
        onError: (err) => {
          const kind = repeatKind(err);
          if (kind) {
            // The problem names the first match; the check gives the full list with links.
            check.mutate(
              { productId, kind: 'idea', title: values.title, body: summary },
              {
                onSuccess: (r) => setRepeat({ status: kind, title: values.title.trim(), matches: r.matches }),
                onError: () => setRepeat({ status: kind, title: values.title.trim(), matches: [] }),
              },
            );
            return;
          }
          const m = errorMessage(err);
          toast.error(m.title, { description: m.detail });
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New idea</DialogTitle>
          <DialogDescription>For {productName}. It goes to the New column.</DialogDescription>
        </DialogHeader>
        <form id="new-idea-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field label="Title" required error={errors.title}>
            <Input autoFocus maxLength={IDEA_TITLE_MAX} {...register('title')} />
          </Field>
          {repeat ? <MemoryMatches status={repeat.status} matches={repeat.matches} /> : null}
          {repeat?.status === 'similar' ? (
            <Field label="Use anyway, because..." required hint="Say what makes it new. Saved in the audit log." error={errors.similarReason}>
              <Textarea rows={2} maxLength={SIMILAR_REASON_MAX} {...register('similarReason')} />
            </Field>
          ) : null}
          <Field label="Why it fits" hint="One line. Optional." error={errors.summary}>
            <Textarea rows={2} maxLength={IDEA_SUMMARY_MAX} {...register('summary')} />
          </Field>
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <Field label="Mode" required error={errors.mode}>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTENT_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {modeLabel(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="channels"
            render={({ field }) => (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium text-ink">Channels</legend>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {PLATFORMS.map((p) => {
                    const id = `new-idea-${p}`;
                    return (
                      <label key={p} htmlFor={id} className="flex items-center gap-2 text-sm text-ink">
                        <Checkbox
                          id={id}
                          checked={field.value.includes(p)}
                          onCheckedChange={(checked) =>
                            field.onChange(checked === true ? [...field.value, p] : field.value.filter((c) => c !== p))
                          }
                        />
                        {PLATFORM_LABELS[p]}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="new-idea-form"
            variant="dark"
            loading={create.isPending || check.isPending}
            disabled={repeat?.status === 'duplicate'}
          >
            {repeat?.status === 'similar' ? 'Add anyway' : 'Add idea'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
