/**
 * Lead dialogs: add or edit a lead, and log a call or note. No price or money field anywhere.
 */
import * as React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LEAD_SOURCES, type LeadView, type Product } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input, Textarea } from '@/components/atoms/Input';
import { Field } from '@/components/molecules/Field';
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
import { isApiError } from '@/lib/api';
import { useSessionStore } from '@/stores/session';
import { useAddLeadActivity, useCreateLead, useUpdateLead } from '../api';
import { LEAD_SOURCE_LABELS } from '../labels';

const leadFormSchema = z.object({
  productId: z.string().min(1, 'Choose a product'),
  organisation: z.string().trim().min(1, 'Enter the organisation').max(200),
  source: z.enum(LEAD_SOURCES),
  sourceText: z.string().trim().max(300),
  who: z.string().trim().max(300),
  firstOffer: z.string().trim().max(500),
  ownedByMe: z.boolean(),
  ownerNote: z.string().trim().max(200),
  nextStep: z.string().trim().max(300),
  nextStepDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a date'),
});
type LeadForm = z.infer<typeof leadFormSchema>;

/** `YYYY-MM-DD` from the browser date input, sent as 09:00 local time. */
function dateToIso(d: string): string | null {
  return d ? new Date(`${d}T09:00:00`).toISOString() : null;
}
function isoToDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  defaultProductId: string | null;
  /** Edit this lead; create a new one when left out. */
  lead?: LeadView | null;
  onSaved?: (lead: LeadView) => void;
}

export function LeadFormDialog({
  open,
  onOpenChange,
  products,
  defaultProductId,
  lead,
  onSaved,
}: LeadFormDialogProps) {
  const me = useSessionStore((s) => s.user);
  const create = useCreateLead();
  const update = useUpdateLead();
  const busy = create.isPending || update.isPending;
  const editing = Boolean(lead);

  const defaults = React.useCallback(
    (): LeadForm => ({
      productId: lead?.productId ?? defaultProductId ?? products[0]?.id ?? '',
      organisation: lead?.organisation ?? '',
      source: lead?.source ?? 'manual',
      sourceText: lead?.sourceText ?? '',
      who: lead?.who ?? '',
      firstOffer: lead?.firstOffer ?? '',
      ownedByMe: lead ? lead.owner?.id === me?.id : true,
      ownerNote: lead?.ownerNote ?? '',
      nextStep: lead?.nextStep ?? '',
      nextStepDate: isoToDate(lead?.nextStepAt ?? null),
    }),
    [lead, defaultProductId, products, me?.id],
  );

  const form = useForm<LeadForm>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: defaults(),
  });
  const { register, handleSubmit, control, formState, reset, setError } = form;

  React.useEffect(() => {
    if (open) reset(defaults());
  }, [open, reset, defaults]);

  const onSubmit = handleSubmit(async (v) => {
    const common = {
      organisation: v.organisation,
      sourceText: v.sourceText,
      who: v.who,
      firstOffer: v.firstOffer,
      // Unticking keeps someone else's ownership; it only clears the owner when that was me.
      ...(v.ownedByMe
        ? { ownerId: me?.id ?? null }
        : lead?.owner && lead.owner.id !== me?.id
          ? {}
          : { ownerId: null }),
      ownerNote: v.ownerNote,
      nextStep: v.nextStep,
      nextStepAt: dateToIso(v.nextStepDate),
    };
    try {
      const saved = lead
        ? await update.mutateAsync({ id: lead.id, input: common })
        : await create.mutateAsync({ ...common, productId: v.productId, source: v.source });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (isApiError(error)) {
        for (const e of error.errors) {
          const key = e.path.replace(/^body\./, '');
          if (key in leadFormSchema.shape) setError(key as keyof LeadForm, { message: e.message });
        }
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit lead' : 'Add a lead'}</DialogTitle>
          <DialogDescription>
            Keep it to what the team needs: the organisation, who, where it came from, the first
            offer. No prices.
          </DialogDescription>
        </DialogHeader>
        <form
          id="lead-form"
          className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          {!editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Product" required error={formState.errors.productId}>
                <Controller
                  control={control}
                  name="productId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-label="Product">
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Source" required error={formState.errors.source}>
                <Controller
                  control={control}
                  name="source"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger aria-label="Source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LEAD_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {LEAD_SOURCE_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>
          ) : null}
          <Field label="Organisation" required error={formState.errors.organisation}>
            <Input placeholder="Tamil Sangam, Singapore" autoFocus {...register('organisation')} />
          </Field>
          <Field
            label="Source detail"
            hint="For example: Comment CIRCLE on Reel 11"
            error={formState.errors.sourceText}
          >
            <Input {...register('sourceText')} />
          </Field>
          <Field
            label="Who"
            hint="A role, not a profile. For example: Community secretary · 400 members"
            error={formState.errors.who}
          >
            <Input {...register('who')} />
          </Field>
          <Field label="First offer" error={formState.errors.firstOffer}>
            <Textarea rows={2} {...register('firstOffer')} />
          </Field>
          <div className="flex flex-col gap-2">
            <Controller
              control={control}
              name="ownedByMe"
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="lead-owned-by-me"
                    checked={field.value}
                    onCheckedChange={(c) => field.onChange(c === true)}
                  />
                  <Label htmlFor="lead-owned-by-me">I own this lead</Label>
                </div>
              )}
            />
            <Field
              label="Owner note"
              hint="When the owner is not in Growth Desk yet. For example: Community owner (to name)"
              error={formState.errors.ownerNote}
            >
              <Input {...register('ownerNote')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <Field label="Next step" error={formState.errors.nextStep}>
              <Input placeholder="Intro call" {...register('nextStep')} />
            </Field>
            <Field label="Date" error={formState.errors.nextStepDate}>
              <Input type="date" {...register('nextStepDate')} />
            </Field>
          </div>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={busy}>
            {editing ? 'Save' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Log a call or note ---------- */

const activityFormSchema = z.object({
  kind: z.enum(['call', 'note', 'email', 'meeting']),
  body: z.string().trim().min(1, 'Write what happened').max(4000),
});
type ActivityForm = z.infer<typeof activityFormSchema>;

const ACTIVITY_LABELS: Record<ActivityForm['kind'], string> = {
  call: 'Call',
  note: 'Note',
  email: 'Email',
  meeting: 'Meeting',
};

export function LogActivityDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: LeadView;
}) {
  const add = useAddLeadActivity(lead.id);
  const form = useForm<ActivityForm>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: { kind: 'call', body: '' },
  });
  const { register, handleSubmit, control, formState, reset } = form;

  React.useEffect(() => {
    if (open) reset({ kind: 'call', body: '' });
  }, [open, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      await add.mutateAsync(v);
      onOpenChange(false);
    } catch {
      /* toast shown by the hook */
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (add.isPending ? undefined : onOpenChange(o))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log for {lead.organisation}</DialogTitle>
          <DialogDescription>
            It goes into the lead’s activity log with your name.
          </DialogDescription>
        </DialogHeader>
        <form
          id="activity-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => void onSubmit(e)}
          noValidate
        >
          <Field label="Kind" error={formState.errors.kind}>
            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger aria-label="Kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTIVITY_LABELS) as ActivityForm['kind'][]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {ACTIVITY_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field label="What happened" required error={formState.errors.body}>
            <Textarea rows={4} autoFocus {...register('body')} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="activity-form" loading={add.isPending}>
            Log it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
