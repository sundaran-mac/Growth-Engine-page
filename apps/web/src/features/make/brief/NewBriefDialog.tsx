import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  BRIEF_KIND_PREFIX,
  BRIEF_KINDS,
  CONTENT_MODES,
  createBriefSchema,
  PLATFORM_LABELS,
  PLATFORMS,
  SIMILAR_REASON_MAX,
  SIMILAR_REASON_MIN,
  type MemoryMatch,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input, Textarea } from '@/components/atoms/Input';
import { Field } from '@/components/molecules/Field';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { MemoryMatches } from '@/features/ideas/components/MemoryMatches';
import { repeatKind, useMemoryCheck } from '@/features/ideas/memory';
import { useCreateBrief } from '../api';
import { modeLabel, toggleIn } from './labels';

type FormIn = z.input<typeof createBriefSchema>;
type FormOut = z.output<typeof createBriefSchema>;

const KIND_LABELS: Record<(typeof BRIEF_KINDS)[number], string> = {
  reel: 'Reel',
  poster: 'Poster',
  short: 'Short',
  carousel: 'Carousel',
  post: 'Post',
};

export function NewBriefDialog({
  open,
  onOpenChange,
  productId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
}) {
  const navigate = useNavigate();
  const create = useCreateBrief();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(createBriefSchema),
    defaultValues: { productId, title: '', kind: 'reel', mode: 'M1', channels: [] },
  });
  const { register, control, handleSubmit, formState, reset, setError } = form;
  const check = useMemoryCheck();
  const [lastRepeat, setRepeat] = React.useState<{ status: 'duplicate' | 'similar'; title: string; matches: MemoryMatch[] } | null>(null);
  const title = useWatch({ control, name: 'title' });
  // The matches belong to the title that was checked; a changed title needs a new check.
  const repeat = lastRepeat && lastRepeat.title === (title ?? '').trim() ? lastRepeat : null;

  const onSubmit = handleSubmit(async (values) => {
    const reason = values.similarReason?.trim() ?? '';
    if (repeat?.status === 'similar' && reason.length < SIMILAR_REASON_MIN) {
      setError('similarReason', { message: `Write at least ${SIMILAR_REASON_MIN} characters` });
      return;
    }
    try {
      const { similarReason: _omit, ...rest } = values;
      const brief = await create.mutateAsync({ ...rest, productId, ...(repeat?.status === 'similar' ? { similarReason: reason } : {}) });
      toast.success(`${brief.code} created`);
      reset();
      onOpenChange(false);
      navigate(`/briefs/${brief.id}`);
    } catch (err) {
      const kind = repeatKind(err);
      if (kind) {
        // The full list of earlier pieces, with links, comes from the check endpoint.
        const matches = await check
          .mutateAsync({ productId, kind: 'brief_hook', title: values.title, body: values.hook ?? null })
          .then((r) => r.matches)
          .catch(() => []);
        setRepeat({ status: kind, title: values.title.trim(), matches });
        return;
      }
      if (isApiError(err) && err.errors.length > 0) {
        for (const e of err.errors) {
          const key = e.path.replace(/^body\./, '');
          if (key === 'title' || key === 'mode' || key === 'kind' || key === 'channels') setError(key, { message: e.message });
        }
      }
      toast.error(isApiError(err) ? err.title : 'Could not create the brief', {
        ...(isApiError(err) && err.detail ? { description: err.detail } : {}),
      });
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (formState.isSubmitting ? undefined : onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New brief</DialogTitle>
          <DialogDescription>Start a piece by hand. You write the hook, beats and ask next.</DialogDescription>
        </DialogHeader>
        <form id="new-brief-form" onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
          <Field label="Title" required error={formState.errors.title}>
            <Input {...register('title')} placeholder="60 seconds with Elan, ep. 2" autoFocus />
          </Field>
          {repeat ? <MemoryMatches status={repeat.status} matches={repeat.matches} what="brief" /> : null}
          {repeat?.status === 'similar' ? (
            <Field label="Use anyway, because..." required hint="Say what makes it new. Saved in the audit log." error={formState.errors.similarReason}>
              <Textarea rows={2} maxLength={SIMILAR_REASON_MAX} {...register('similarReason', { shouldUnregister: true })} />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-brief-kind">Kind</Label>
                  <Select value={field.value ?? 'reel'} onValueChange={field.onChange}>
                    <SelectTrigger id="new-brief-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BRIEF_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABELS[k]} ({BRIEF_KIND_PREFIX[k]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            />
            <Controller
              control={control}
              name="mode"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-brief-mode">Mode</Label>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="new-brief-mode">
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
                </div>
              )}
            />
          </div>
          <Controller
            control={control}
            name="channels"
            render={({ field }) => {
              const selected = field.value ?? [];
              return (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-13 font-semibold">Channels</legend>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map((p) => {
                      const on = selected.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={on}
                          onClick={() => field.onChange(toggleIn(selected, p, PLATFORMS))}
                          className={cn(
                            'focus-ring rounded-pill border px-3 py-1 text-xs font-semibold',
                            on ? 'border-joy bg-joy text-ink' : 'border-hairline bg-surface-card text-muted hover:text-ink',
                          )}
                        >
                          {PLATFORM_LABELS[p]}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              );
            }}
          />
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="new-brief-form" loading={formState.isSubmitting} disabled={repeat?.status === 'duplicate'}>
            {repeat?.status === 'similar' ? 'Create anyway' : 'Create brief'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
