import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  type BriefKind,
  type PostView,
  type UpdatePostRequest,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input, Textarea } from '@/components/atoms/Input';
import { Field } from '@/components/molecules/Field';
import { MemoryMatches } from '@/features/ideas/components/MemoryMatches';
import { useLiveMemoryCheck } from '@/features/ideas/memory';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { channelLabel, fromZonedInputValue, toZonedInputValue } from './format';
import { AUDIENCE_ZONES } from './rows';

const formSchema = z.object({
  when: z.string(),
  audienceTz: z.string().min(1),
  caption: z.string().max(2200, 'Keep the caption under 2,200 characters'),
  languages: z.array(z.enum(LANGUAGES)).max(2),
});
type FormValues = z.infer<typeof formSchema>;

export interface EditPostDialogProps {
  post: PostView | null;
  briefKind: BriefKind | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Returns a promise; the dialog closes when it resolves. */
  onSave: (body: UpdatePostRequest) => Promise<unknown>;
}

/** Edit the time (in the audience zone), zone, caption and languages of one post. */
export function EditPostDialog({
  post,
  briefKind,
  open,
  onOpenChange,
  onSave,
}: EditPostDialogProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  React.useEffect(() => {
    if (post && open) {
      reset({
        when: post.scheduledAt ? toZonedInputValue(post.scheduledAt, post.audienceTz) : '',
        audienceTz: post.audienceTz,
        caption: post.caption ?? '',
        languages: post.languages,
      });
    }
  }, [post, open, reset]);

  const watchedTz = useWatch({ control, name: 'audienceTz' });
  const watchedCaption = useWatch({ control, name: 'caption' });
  const { productId } = useSelectedProduct();
  // Content memory: two different briefs must not share a near-identical caption (any product).
  const captionCheck = useLiveMemoryCheck(
    open && post && productId && watchedCaption?.trim()
      ? { productId, kind: 'post_caption', title: watchedCaption.trim().slice(0, 200), body: watchedCaption.trim(), excludeBriefId: post.briefId }
      : null,
  );

  if (!post) return null;
  const zones = AUDIENCE_ZONES.some((z) => z.tz === post.audienceTz)
    ? AUDIENCE_ZONES
    : [...AUDIENCE_ZONES, { tz: post.audienceTz, label: post.audienceTz }];
  const tz = watchedTz ?? post.audienceTz;

  async function submit(values: FormValues) {
    if (!post) return;
    let scheduledAt: string | null = null;
    if (values.when) {
      scheduledAt = fromZonedInputValue(values.when, values.audienceTz);
      if (!scheduledAt) {
        setError('when', { message: 'Pick a valid date and time' });
        return;
      }
    } else if (post.status !== 'draft') {
      setError('when', { message: 'A scheduled post needs a time' });
      return;
    }
    const body: UpdatePostRequest = {};
    if (scheduledAt !== post.scheduledAt) body.scheduledAt = scheduledAt;
    if (values.audienceTz !== post.audienceTz) body.audienceTz = values.audienceTz;
    const caption = values.caption.trim() === '' ? null : values.caption.trim();
    if (caption !== (post.caption ?? null)) body.caption = caption;
    if (values.languages.join(',') !== post.languages.join(',')) body.languages = values.languages;
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    try {
      await onSave(body);
      onOpenChange(false);
    } catch {
      /* the page shows a toast; keep the dialog open */
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (isSubmitting ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit {channelLabel(post.platform, briefKind, post.channel.displayName)}
          </DialogTitle>
          <DialogDescription>Times are in the audience time zone.</DialogDescription>
        </DialogHeader>
        <form
          id="edit-post-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => void handleSubmit(submit)(e)}
          noValidate
        >
          <Field label="When (audience time)" error={errors.when} hint={tz}>
            <Input type="datetime-local" {...register('when')} />
          </Field>
          <Field label="Audience time zone" error={errors.audienceTz}>
            <Controller
              control={control}
              name="audienceTz"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Audience time zone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.tz} value={z.tz}>
                        {z.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="Caption" error={errors.caption}>
            <Textarea rows={5} {...register('caption')} />
          </Field>
          {captionCheck && captionCheck.status !== 'unique' ? (
            <MemoryMatches
              status={captionCheck.status}
              matches={captionCheck.matches}
              what="caption"
              note="This caption is close to one used for another piece. Change it so each post stays unique."
            />
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">Caption languages</legend>
            <Controller
              control={control}
              name="languages"
              render={({ field }) => (
                <div className="flex gap-6">
                  {LANGUAGES.map((lang) => {
                    const id = `edit-post-lang-${lang}`;
                    const checked = field.value?.includes(lang) ?? false;
                    return (
                      <div key={lang} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(next) =>
                            field.onChange(
                              next === true
                                ? [...(field.value ?? []), lang]
                                : (field.value ?? []).filter((l) => l !== lang),
                            )
                          }
                        />
                        <Label htmlFor={id}>{LANGUAGE_LABELS[lang]}</Label>
                      </div>
                    );
                  })}
                </div>
              )}
            />
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-post-form" variant="dark" loading={isSubmitting}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
