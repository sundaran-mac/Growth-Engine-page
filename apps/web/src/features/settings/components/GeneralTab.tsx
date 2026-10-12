/**
 * General tab: name, colour, status, repo, owner, backup. Saves through the PRODUCTS module
 * (PATCH /products/:id). Placeholder design until Jeeva designs Settings.
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  updateProductRequestSchema,
  type ProductStatus,
  type UpdateProductRequest,
} from '@growth-desk/contract';
import { Input } from '@/components/atoms/Input';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import { useProductDetail, useTeamList, useUpdateProductGeneral } from '../api';
import { errorToast } from '../format';
import { ReadOnlyNote, SaveBar, SettingRow, TabSkeleton } from './shared';
import { useDraft, useReportDirty } from '../draft';

interface GeneralDraft {
  name: string;
  status: ProductStatus;
  color: string;
  repoUrl: string;
  ownerId: string;
  backupId: string;
}

const NONE = '__none__';

export function GeneralTab({ productId, canEdit }: { productId: string; canEdit: boolean }) {
  const detail = useProductDetail(productId);
  const team = useTeamList();
  const update = useUpdateProductGeneral(productId);

  const initial: GeneralDraft | null = React.useMemo(() => {
    const p = detail.data;
    if (!p) return null;
    return {
      name: p.name,
      status: p.status,
      color: p.color ?? '',
      repoUrl: p.repoUrl ?? '',
      ownerId: p.owner?.id ?? NONE,
      backupId: p.backup?.id ?? NONE,
    };
  }, [detail.data]);

  const { draft, setDraft, dirty, reset } = useDraft<GeneralDraft | null>(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  useReportDirty('general', dirty);

  if (detail.isPending) return <TabSkeleton />;
  if (detail.isError || !draft || !initial) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => void detail.refetch()}
        retrying={detail.isFetching}
      />
    );
  }

  const set = <K extends keyof GeneralDraft>(k: K, v: GeneralDraft[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  async function save() {
    if (!draft || !initial) return;
    const patch: UpdateProductRequest = {};
    if (draft.name !== initial.name) patch.name = draft.name.trim();
    if (draft.status !== initial.status) patch.status = draft.status;
    if (draft.color !== initial.color) patch.color = draft.color || null;
    if (draft.repoUrl !== initial.repoUrl) patch.repoUrl = draft.repoUrl.trim() || null;
    if (draft.ownerId !== initial.ownerId)
      patch.ownerId = draft.ownerId === NONE ? null : draft.ownerId;
    if (draft.backupId !== initial.backupId)
      patch.backupId = draft.backupId === NONE ? null : draft.backupId;
    const parsed = updateProductRequestSchema.safeParse(patch);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const i of parsed.error.issues) next[String(i.path[0] ?? 'name')] ??= i.message;
      setErrors(next);
      toast.error('Check the highlighted fields');
      return;
    }
    try {
      await update.mutateAsync(patch);
      reset();
      setErrors({});
      toast.success('Product saved');
    } catch (error) {
      if (isApiError(error)) {
        const next: Record<string, string> = {};
        for (const fe of error.errors) next[fe.path.replace(/^body\./, '')] ??= fe.message;
        setErrors(next);
      }
      toast.error(...errorToast(error, 'Product not saved'));
    }
  }

  // Active team members, plus the current owner and backup even when the team list is not loaded.
  const people: { id: string; name: string; title: string | null }[] =
    team.data?.items.filter((u) => u.isActive) ?? [];
  for (const ref of [detail.data.owner, detail.data.backup]) {
    if (ref && !people.some((p) => p.id === ref.id))
      people.push({ id: ref.id, name: ref.name, title: null });
  }
  const disabled = !canEdit || update.isPending;

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel title="Product" description="How the product shows across Growth Desk.">
        <SettingRow title="Name" htmlFor="gen-name">
          <Input
            id="gen-name"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            disabled={disabled}
            aria-invalid={errors.name ? true : undefined}
          />
          {errors.name ? <FieldError text={errors.name} /> : null}
        </SettingRow>
        <SettingRow title="Status" htmlFor="gen-status">
          <Select
            value={draft.status}
            onValueChange={(v) => set('status', v as ProductStatus)}
            disabled={disabled}
          >
            <SelectTrigger id="gen-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRODUCT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {PRODUCT_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          title="Colour"
          help="Dot colour in the switcher and on cards."
          htmlFor="gen-color"
        >
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick a colour"
              value={/^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#ff9a00'}
              onChange={(e) => set('color', e.target.value)}
              disabled={disabled}
              className="focus-ring size-11 shrink-0 cursor-pointer rounded-tile border border-strong bg-surface-card p-1 disabled:cursor-not-allowed"
            />
            <Input
              id="gen-color"
              value={draft.color}
              placeholder="#ff9a00"
              onChange={(e) => set('color', e.target.value)}
              disabled={disabled}
              aria-invalid={errors.color ? true : undefined}
            />
          </div>
          {errors.color ? <FieldError text={errors.color} /> : null}
        </SettingRow>
        <SettingRow
          title="Repo URL"
          help="The product's GitHub repo, for the kit and specs."
          htmlFor="gen-repo"
        >
          <Input
            id="gen-repo"
            type="url"
            value={draft.repoUrl}
            placeholder="https://github.com/humini-ecosystem/humini-live-app"
            onChange={(e) => set('repoUrl', e.target.value)}
            disabled={disabled}
            aria-invalid={errors.repoUrl ? true : undefined}
          />
          {errors.repoUrl ? <FieldError text={errors.repoUrl} /> : null}
        </SettingRow>
      </Panel>
      <Panel
        title="People"
        description="The owner signs the kit and approves claims. The backup steps in after 24 hours."
      >
        <SettingRow title="Owner" htmlFor="gen-owner">
          <PersonPicker
            id="gen-owner"
            value={draft.ownerId}
            people={people}
            onChange={(v) => set('ownerId', v)}
            disabled={disabled}
          />
          {errors.ownerId ? <FieldError text={errors.ownerId} /> : null}
        </SettingRow>
        <SettingRow title="Backup" htmlFor="gen-backup">
          <PersonPicker
            id="gen-backup"
            value={draft.backupId}
            people={people}
            onChange={(v) => set('backupId', v)}
            disabled={disabled}
          />
          {errors.backupId ? <FieldError text={errors.backupId} /> : null}
        </SettingRow>
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={update.isPending}
        onSave={() => void save()}
        onDiscard={reset}
        disabled={!canEdit}
      />
    </div>
  );
}

function PersonPicker({
  id,
  value,
  people,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  people: { id: string; name: string; title: string | null }[];
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose a person" />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={NONE}>To confirm (nobody yet)</SelectItem>
        {people.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
            {p.title ? ` · ${p.title}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FieldError({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-1.5 text-xs font-medium text-danger-text">
      {text}
    </p>
  );
}
