/**
 * Local draft of some product settings fields. Validates with the contract schema, saves only
 * the changed fields (PATCH), and reports unsaved changes to the page.
 * `keys` must be a module-level constant array.
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  updateProductSettingsSchema,
  type ProductSettingsDetail,
  type UpdateProductSettings,
} from '@growth-desk/contract';
import { isApiError } from '@/lib/api';
import { useUpdateSettings } from './api';
import { useDraft, useReportDirty } from './draft';
import { errorToast } from './format';

export type SettingsFields = Required<UpdateProductSettings>;
export type SettingsKey = keyof SettingsFields;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function pick<K extends SettingsKey>(
  detail: ProductSettingsDetail,
  keys: readonly K[],
): Pick<SettingsFields, K> {
  const out = {} as Pick<SettingsFields, K>;
  for (const k of keys) out[k] = detail[k] as SettingsFields[K];
  return out;
}

export function useSettingsDraft<K extends SettingsKey>(
  detail: ProductSettingsDetail,
  keys: readonly K[],
  dirtyKey: string,
) {
  const initial = React.useMemo(() => pick(detail, keys), [detail, keys]);
  const { draft, setDraft, dirty, reset } = useDraft(initial);
  const [errors, setErrors] = React.useState<Partial<Record<K, string>>>({});
  const update = useUpdateSettings(detail.productId);
  useReportDirty(dirtyKey, dirty);

  const set = React.useCallback(
    <F extends K>(field: F, value: SettingsFields[F]) => {
      setDraft((d) => ({ ...d, [field]: value }));
      setErrors((e) => ({ ...e, [field]: undefined }));
    },
    [setDraft],
  );

  const discard = React.useCallback(() => {
    reset();
    setErrors({});
  }, [reset]);

  const save = React.useCallback(async (): Promise<boolean> => {
    const changed = keys.filter((k) => !same(draft[k], initial[k]));
    if (changed.length === 0) return true;
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = draft[k];
    const parsed = updateProductSettingsSchema.safeParse(patch);
    if (!parsed.success) {
      const next: Partial<Record<K, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as K | undefined;
        if (field && !next[field]) next[field] = issue.message;
      }
      setErrors(next);
      toast.error('Check the highlighted fields');
      return false;
    }
    try {
      await update.mutateAsync(parsed.data);
      setErrors({});
      toast.success('Settings saved');
      return true;
    } catch (error) {
      if (isApiError(error) && error.errors.length > 0) {
        const next: Partial<Record<K, string>> = {};
        for (const fe of error.errors) {
          const field = fe.path.replace(/^body\./, '').split('.')[0] as K;
          if (keys.includes(field)) next[field] = fe.message;
        }
        setErrors(next);
      }
      toast.error(...errorToast(error, 'Settings not saved'));
      return false;
    }
  }, [draft, initial, keys, update]);

  return { draft, set, errors, dirty, save, discard, saving: update.isPending };
}
