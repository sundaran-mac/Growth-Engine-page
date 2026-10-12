import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CONTENT_MODES,
  PLAN_ITEM_TITLE_MAX,
  PLATFORMS,
  PLATFORM_LABELS,
  type Idea,
  type PlanItemView,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { errorMessage } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import { useAddPlanItem, useDeletePlanItem, useUpdatePlanItem } from '../api';
import { longDate, modeLabel, monthBounds } from '../lib';

const NONE = 'none';
const CUSTOM = 'custom';

const baseSchema = z.object({
  ideaId: z.string(),
  title: z.string().trim().max(PLAN_ITEM_TITLE_MAX),
  mode: z.string(),
  channel: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day'),
  needsShootSlot: z.boolean(),
});
const formSchema = baseSchema.refine((v) => v.ideaId !== CUSTOM || v.title.length > 0, { message: 'Give the piece a title', path: ['title'] });
type FormValues = z.infer<typeof formSchema>;

export type PlanItemDialogState = { kind: 'add'; date: string } | { kind: 'edit'; item: PlanItemView } | null;

export interface PlanItemDialogProps {
  state: PlanItemDialogState;
  onClose: () => void;
  planId: string;
  productId: string;
  month: string;
  starredIdeas: Idea[];
  editable: boolean;
}

/** Add a piece (from a starred idea or by hand) or edit, move and remove one. */
export function PlanItemDialog({ state, onClose, planId, productId, month, starredIdeas, editable }: PlanItemDialogProps) {
  const add = useAddPlanItem();
  const update = useUpdatePlanItem(productId, month);
  const remove = useDeletePlanItem();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const { from, to } = monthBounds(month);
  const editing = state?.kind === 'edit' ? state.item : null;

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  React.useEffect(() => {
    if (!state) return;
    if (state.kind === 'add') {
      reset({
        ideaId: starredIdeas[0]?.id ?? CUSTOM,
        title: '',
        mode: NONE,
        channel: NONE,
        date: state.date,
        needsShootSlot: false,
      });
    } else {
      const i = state.item;
      reset({
        ideaId: i.ideaId ?? CUSTOM,
        title: i.title,
        mode: i.mode ?? NONE,
        channel: i.channel ?? NONE,
        date: i.date,
        needsShootSlot: i.needsShootSlot,
      });
    }
  }, [state, reset, starredIdeas]);

  const ideaId = useWatch({ control, name: 'ideaId' });
  const fromIdea = state?.kind === 'add' && ideaId !== CUSTOM;
  const pending = add.isPending || update.isPending;

  function onServerError(err: unknown) {
    if (isApiError(err) && err.errors.length > 0) {
      for (const fe of err.errors) {
        const field = fe.path.replace(/^body\./, '') as keyof FormValues;
        if (field in baseSchema.shape) setError(field, { message: fe.message });
      }
      return;
    }
    const m = errorMessage(err);
    toast.error(m.title, { description: m.detail });
  }

  const onSubmit = handleSubmit((v) => {
    const mode = v.mode === NONE ? null : (v.mode as (typeof CONTENT_MODES)[number]);
    const channel = v.channel === NONE ? null : (v.channel as (typeof PLATFORMS)[number]);
    if (state?.kind === 'add') {
      const input = fromIdea
        ? { date: v.date, ideaId: v.ideaId, needsShootSlot: v.needsShootSlot, ...(channel ? { channel } : {}) }
        : { date: v.date, title: v.title, mode, channel, needsShootSlot: v.needsShootSlot };
      add.mutate(
        { planId, input },
        {
          onSuccess: (item) => {
            toast.success('Added to the plan', { description: `${item.title} · ${longDate(item.date)}` });
            onClose();
          },
          onError: onServerError,
        },
      );
    } else if (editing) {
      update.mutate(
        { itemId: editing.id, input: { date: v.date, title: v.title, mode, channel, needsShootSlot: v.needsShootSlot } },
        {
          onSuccess: () => {
            toast.success('Piece saved');
            onClose();
          },
          onError: onServerError,
        },
      );
    }
  });

  const title = state?.kind === 'add' ? 'Add a piece' : editable ? 'Edit piece' : (editing?.title ?? 'Piece');

  return (
    <>
      <Dialog open={state !== null && !confirmDelete} onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {state?.kind === 'add' ? `On ${longDate(state.date)}.` : editing ? longDate(editing.date) : null}
              {editing?.briefCode && editing.briefId ? (
                <>
                  {' '}
                  Brief{' '}
                  <Link to={`/briefs/${editing.briefId}`} className="font-semibold text-ink underline underline-offset-2">
                    {editing.briefCode}
                  </Link>
                  .
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <form id="plan-item-form" onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <fieldset disabled={!editable || pending} className="flex flex-col gap-4">
              {state?.kind === 'add' ? (
                <Controller
                  control={control}
                  name="ideaId"
                  render={({ field }) => (
                    <Field label="From a starred idea" hint={starredIdeas.length === 0 ? 'No starred ideas yet. Star some on the Ideas board.' : undefined}>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {starredIdeas.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.mode} · {i.title}
                            </SelectItem>
                          ))}
                          <SelectItem value={CUSTOM}>Something else (type a title)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
              ) : null}

              {!fromIdea ? (
                <>
                  <Field label="Title" required error={errors.title}>
                    <Input maxLength={PLAN_ITEM_TITLE_MAX} {...register('title')} />
                  </Field>
                  <Controller
                    control={control}
                    name="mode"
                    render={({ field }) => (
                      <Field label="Mode" hint="Leave empty for an occasion post.">
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE}>No mode</SelectItem>
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
                </>
              ) : null}

              <Controller
                control={control}
                name="channel"
                render={({ field }) => (
                  <Field label="Channel" hint={fromIdea ? 'Empty uses the idea’s first channel.' : undefined}>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{fromIdea ? 'Idea’s first channel' : 'No channel yet'}</SelectItem>
                        {PLATFORMS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {PLATFORM_LABELS[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              <Field label="Day" required error={errors.date}>
                <Input type="date" min={from} max={to} {...register('date')} />
              </Field>

              <Controller
                control={control}
                name="needsShootSlot"
                render={({ field }) => (
                  <label className="flex items-center gap-2.5 text-sm text-ink">
                    <Checkbox checked={field.value} onCheckedChange={(c) => field.onChange(c === true)} />
                    Needs a shoot slot (not booked yet)
                  </label>
                )}
              />
            </fieldset>
          </form>

          <DialogFooter className="sm:justify-between">
            {editing && editable ? (
              <Button variant="ghost" className="text-danger-text" onClick={() => setConfirmDelete(true)} disabled={pending}>
                Remove
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <Button variant="secondary" onClick={onClose} disabled={pending}>
                {editable ? 'Cancel' : 'Close'}
              </Button>
              {editable ? (
                <Button type="submit" form="plan-item-form" variant="dark" loading={pending}>
                  {state?.kind === 'add' ? 'Add to plan' : 'Save'}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(open) => setConfirmDelete(open)}
        title="Remove this piece?"
        description={editing ? `“${editing.title}” comes off the plan. The idea stays on the board.` : undefined}
        confirmLabel="Remove piece"
        tone="danger"
        onConfirm={() =>
          editing
            ? remove.mutateAsync(editing.id).then(
                () => {
                  toast.success('Piece removed');
                  onClose();
                },
                (err: unknown) => {
                  const m = errorMessage(err);
                  toast.error(m.title, { description: m.detail });
                  throw err;
                },
              )
            : undefined
        }
      />
    </>
  );
}
