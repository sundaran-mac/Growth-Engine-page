/**
 * Studio edits to a file's metadata: manual loudness (v1), ratio, licence, consent and AI label.
 * Saved with PATCH /assets/:id; read only outside the frozen and made stages.
 */
import { PencilSimple } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import {
  LOUDNESS_TARGET_LUFS,
  RATIOS,
  type MakeAsset,
  type Ratio,
  type UpdateAssetInput,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { StatusChip } from '@/components/atoms/StatusChip';
import { errorMessage } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUpdateAsset } from '../api';
import { hasLoudness, isLoudnessOffTarget, loudnessLabel, parseLufsInput } from './helpers';

function useSaveAsset(briefId: string) {
  const update = useUpdateAsset(briefId);
  const save = (asset: MakeAsset, input: UpdateAssetInput, done: () => void) =>
    update.mutate(
      { id: asset.id, ...input },
      {
        onSuccess: () => {
          toast.success('File details saved', { description: asset.fileName ?? undefined });
          done();
        },
        onError: (err) => {
          const m = errorMessage(err);
          toast.error('Could not save the file details', { description: m.detail ?? m.title });
        },
      },
    );
  return { save, pending: update.isPending };
}

/** "-11.8 LUFS (target -14)" with an inline edit (input + Save). */
export function LoudnessInline({ briefId, asset, canEdit }: { briefId: string; asset: MakeAsset; canEdit: boolean }) {
  const { save, pending } = useSaveAsset(briefId);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const target = LOUDNESS_TARGET_LUFS;
  const off = asset.loudnessLufs !== null && isLoudnessOffTarget(asset.loudnessLufs, target);

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <StatusChip tone={asset.loudnessLufs === null ? 'neutral' : off ? 'reminder' : 'care'}>
          {loudnessLabel(asset.loudnessLufs, target)}
        </StatusChip>
        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setValue(asset.loudnessLufs === null ? '' : String(asset.loudnessLufs));
              setError(null);
              setEditing(true);
            }}
            aria-label={`Edit loudness of ${asset.fileName ?? 'file'}`}
          >
            Edit
          </Button>
        ) : null}
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseLufsInput(value);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    save(asset, { loudnessLufs: parsed.value }, () => setEditing(false));
  }

  return (
    <form className="flex flex-wrap items-start gap-2" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId} className="sr-only">
          Loudness in LUFS
        </Label>
        <Input
          id={inputId}
          type="number"
          inputMode="decimal"
          step={0.1}
          min={-70}
          max={0}
          className="h-9 w-28"
          value={value}
          placeholder={String(target)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          autoFocus
        />
        {error ? (
          <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-danger-text">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="sm" loading={pending}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
        Cancel
      </Button>
    </form>
  );
}

/** Pencil button + dialog for loudness, ratio, licence, consent and AI label. */
export function AssetDetailsButton({ briefId, asset }: { briefId: string; asset: MakeAsset }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={PencilSimple}
        onClick={() => setOpen(true)}
        aria-label={`Edit details of ${asset.fileName ?? 'file'}`}
      >
        Details
      </Button>
      {open ? <AssetDetailsDialog briefId={briefId} asset={asset} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AssetDetailsDialog({ briefId, asset, onClose }: { briefId: string; asset: MakeAsset; onClose: () => void }) {
  const { save, pending } = useSaveAsset(briefId);
  const [licence, setLicence] = React.useState(asset.licence ?? '');
  const [consent, setConsent] = React.useState(asset.consentOnFile);
  const [ai, setAi] = React.useState(asset.aiGenerated);
  const [ratio, setRatio] = React.useState<Ratio | null>(asset.ratio);
  const [lufs, setLufs] = React.useState(asset.loudnessLufs === null ? '' : String(asset.loudnessLufs));
  const [lufsError, setLufsError] = React.useState<string | null>(null);
  const id = React.useId();
  const showLoudness = hasLoudness(asset.kind);
  const showRatio = asset.kind !== 'caption';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input: UpdateAssetInput = {
      licence: licence.trim() || null,
      consentOnFile: consent,
      aiGenerated: ai,
    };
    if (showLoudness) {
      const parsed = parseLufsInput(lufs);
      if ('error' in parsed) {
        setLufsError(parsed.error);
        return;
      }
      input.loudnessLufs = parsed.value;
    }
    if (showRatio && ratio && ratio !== asset.ratio) input.ratio = ratio;
    save(asset, input, onClose);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File details</DialogTitle>
        </DialogHeader>
        <form id={`${id}-form`} className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {showLoudness ? (
            <Field
              label={`Loudness (LUFS), target ${LOUDNESS_TARGET_LUFS}`}
              hint="Integrated loudness of the mix. Leave empty when not measured yet."
              error={lufsError ?? undefined}
            >
              <Input
                type="number"
                inputMode="decimal"
                step={0.1}
                min={-70}
                max={0}
                className="w-32"
                value={lufs}
                placeholder={String(LOUDNESS_TARGET_LUFS)}
                onChange={(e) => {
                  setLufs(e.target.value);
                  setLufsError(null);
                }}
              />
            </Field>
          ) : null}
          {showRatio ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-ratio`}>Ratio</Label>
              <Select value={ratio ?? undefined} onValueChange={(v) => setRatio(v as Ratio)}>
                <SelectTrigger id={`${id}-ratio`} className="w-40">
                  <SelectValue placeholder="Choose a ratio" />
                </SelectTrigger>
                <SelectContent>
                  {RATIOS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Field label="Licence">
            <Input value={licence} onChange={(e) => setLicence(e.target.value)} maxLength={300} />
          </Field>
          <div className="flex items-center gap-2.5">
            <Checkbox id={`${id}-consent`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <Label htmlFor={`${id}-consent`} className="font-medium">
              Consent on file for every face
            </Label>
          </div>
          <div className="flex items-center gap-2.5">
            <Checkbox id={`${id}-ai`} checked={ai} onCheckedChange={(v) => setAi(v === true)} />
            <Label htmlFor={`${id}-ai`} className="font-medium">
              AI generated people or voices (AI label on)
            </Label>
          </div>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} loading={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
