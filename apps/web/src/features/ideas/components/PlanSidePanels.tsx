import { CheckCircle, Plus, Warning } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import type { Occasion, PlanChecks } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { IconButton } from '@/components/atoms/IconButton';
import { Input, Textarea } from '@/components/atoms/Input';
import { errorMessage } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useCreateOccasion } from '../api';
import { MODE_PLAN_CLASS, modeLabel } from '../lib';

const BAR_MAX_PX = 120;

/** "Mix check": pieces per mode with a bar (Figma 240:1275). */
export const MixCheckPanel = React.forwardRef<HTMLElement, { checks: PlanChecks | undefined; loading: boolean }>(
  ({ checks, loading }, ref) => {
    const max = Math.max(1, ...(checks?.mix.map((m) => m.count) ?? [0]));
    return (
      <section ref={ref} tabIndex={-1} aria-labelledby="mix-check-title" className="flex flex-col gap-3 rounded-card border border-hairline bg-surface-card p-6 outline-none">
        <h2 id="mix-check-title" className="text-base font-bold text-ink">
          Mix check
        </h2>
        {loading || !checks ? (
          <div className="flex flex-col gap-3" aria-busy="true">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {checks.mix.map(({ mode, count }) => (
              <li key={mode} className="flex items-center gap-2 text-xs text-ink">
                <span className="w-24 shrink-0">{modeLabel(mode)}</span>
                <span
                  aria-hidden="true"
                  className={cn('h-2.5 rounded-[5px]', MODE_PLAN_CLASS[mode].split(' ')[0])}
                  style={{ width: count === 0 ? 4 : Math.max(12, Math.round((count / max) * BAR_MAX_PX)) }}
                />
                <span className="font-semibold">
                  {count}
                  <span className="sr-only"> pieces</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  },
);
MixCheckPanel.displayName = 'MixCheckPanel';

function occasionText(o: Occasion): string {
  return o.notes ?? o.name;
}

/** "Occasions this month" (care tint, Figma 240:1305). */
export function OccasionsPanel({
  occasions,
  loading,
  canAdd,
  onAdd,
}: {
  occasions: Occasion[];
  loading: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <section aria-labelledby="occasions-title" className="flex flex-col gap-3 rounded-card bg-care-soft p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 id="occasions-title" className="text-base font-bold text-ink">
          Occasions this month
        </h2>
        {canAdd ? (
          <IconButton icon={Plus} variant="ghost" size="sm" label="Add an occasion" onClick={onAdd} className="-mr-2 text-care-text" />
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-10 bg-surface-card/60" />
      ) : occasions.length === 0 ? (
        <p className="text-13 text-care-text">No occasions this month.</p>
      ) : (
        <p className="text-13 text-care-text">{occasions.map(occasionText).join(' · ')}</p>
      )}
    </section>
  );
}

/** "n things to fix" (alert tint, Figma 240:1308). */
export function ThingsToFixPanel({ checks, loading }: { checks: PlanChecks | undefined; loading: boolean }) {
  if (loading || !checks) {
    return <Skeleton className="h-28 rounded-card" />;
  }
  const n = checks.warnings.length;
  if (n === 0) {
    return (
      <section aria-labelledby="fix-title" className="flex flex-col gap-2 rounded-card bg-success-soft p-6">
        <h2 id="fix-title" className="flex items-center gap-2 text-base font-bold text-success-text">
          <Icon icon={CheckCircle} size={18} /> Nothing to fix
        </h2>
        <p className="text-13 text-ink">Every week has a piece and every founder film has a shoot slot.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="fix-title" className="flex flex-col gap-3 rounded-card bg-danger-soft p-6">
      <h2 id="fix-title" className="flex items-center gap-2 text-base font-bold text-danger-text">
        <Icon icon={Warning} size={18} />
        {n === 1 ? '1 thing to fix' : `${n} things to fix`}
      </h2>
      <p className="text-13 text-ink">{checks.warnings.map((w) => w.message).join(' · ')}</p>
    </section>
  );
}

/** Editors add an occasion for the selected product. Mount it when it opens so the form starts empty. */
export function AddOccasionDialog({
  open,
  onOpenChange,
  productId,
  productName,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  defaultDate: string;
}) {
  const create = useCreateOccasion();
  const [name, setName] = React.useState('');
  const [date, setDate] = React.useState(defaultDate);
  const [endDate, setEndDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the occasion a name';
    if (!date) next.date = 'Pick a day';
    if (endDate && endDate < date) next.endDate = 'End must be on or after the start';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    create.mutate(
      { name: name.trim(), date, endDate: endDate || null, notes: notes.trim() || null, productIds: [productId] },
      {
        onSuccess: (o) => {
          toast.success('Occasion added', { description: o.name });
          onOpenChange(false);
        },
        onError: (err) => {
          if (isApiError(err) && err.errors.length > 0) {
            setErrors(Object.fromEntries(err.errors.map((fe) => [fe.path.replace(/^body\./, ''), fe.message])));
            return;
          }
          const m = errorMessage(err);
          toast.error(m.title, { description: m.detail });
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (create.isPending ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an occasion</DialogTitle>
          <DialogDescription>For {productName}. Claude also reads occasions when it drafts ideas.</DialogDescription>
        </DialogHeader>
        <form id="occasion-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Name" required error={errors.name}>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Day" required error={errors.date}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Ends" hint="Optional, for a week like Deepavali." error={errors.endDate}>
              <Input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Short note" hint="Shown in the Occasions panel, for example “Deepavali week”." error={errors.notes}>
            <Textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="occasion-form" variant="dark" loading={create.isPending}>
            Add occasion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
