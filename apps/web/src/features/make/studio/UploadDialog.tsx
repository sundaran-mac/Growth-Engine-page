import { CloudArrowUp, FileArrowUp } from '@phosphor-icons/react';
import * as React from 'react';
import { toast } from 'sonner';
import {
  ASSET_KIND_RULES,
  checkUploadFile,
  LOUDNESS_TARGET_LUFS,
  RATIOS,
  type AssetKind,
  type Ratio,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { Input } from '@/components/atoms/Input';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ASSET_KIND_TITLES, guessMimeType, hasLoudness, parseLufsInput } from './helpers';
import { StorageNotConnected } from './StorageNotConnected';
import { formatBytes, readMediaInfo } from './upload';
import { useAssetUpload } from './useAssetUpload';

/** Extension hint for the file input `accept` attribute. */
function acceptFor(kind: AssetKind): string {
  const mimes = ASSET_KIND_RULES[kind].mimeTypes;
  return kind === 'caption' ? '.vtt,.srt,text/vtt,application/x-subrip' : mimes.join(',');
}

export interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  briefId: string;
  kind: AssetKind;
  defaultRatio?: Ratio | null;
  ratios?: readonly Ratio[];
}

export function UploadDialog({ open, onOpenChange, briefId, kind, defaultRatio = null, ratios = RATIOS }: UploadDialogProps) {
  const upload = useAssetUpload(briefId);
  const [file, setFile] = React.useState<File | null>(null);
  const [ratio, setRatio] = React.useState<Ratio | null>(kind === 'caption' ? null : (defaultRatio ?? ratios[0] ?? null));
  const [licence, setLicence] = React.useState('');
  const [consent, setConsent] = React.useState(false);
  const [aiGenerated, setAiGenerated] = React.useState(false);
  const [lufs, setLufs] = React.useState('');
  const [lufsError, setLufsError] = React.useState<string | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputId = React.useId();

  const busy = upload.state.status === 'uploading';

  function pick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setFileError(checkUploadFile({ kind, mimeType: guessMimeType(f), sizeBytes: f.size, fileName: f.name }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileError('Choose a file to upload.');
      return;
    }
    const mimeType = guessMimeType(file);
    const problem = checkUploadFile({ kind, mimeType, sizeBytes: file.size, fileName: file.name });
    if (problem) {
      setFileError(problem);
      return;
    }
    const parsedLufs = hasLoudness(kind) ? parseLufsInput(lufs) : { value: null };
    if ('error' in parsedLufs) {
      setLufsError(parsedLufs.error);
      return;
    }
    const info = await readMediaInfo(file);
    const asset = await upload.start(
      {
        briefId,
        kind,
        ratio: kind === 'caption' ? null : ratio,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        durationMs: info.durationMs,
        width: info.width,
        height: info.height,
        licence: licence.trim() || null,
        consentOnFile: consent,
        aiGenerated,
        loudnessLufs: parsedLufs.value,
      },
      file,
    );
    if (asset) {
      toast.success('Upload finished', { description: `${asset.fileName ?? file.name} is ready.` });
      onOpenChange(false);
    }
  }

  const state = upload.state;
  const progress = state.status === 'uploading' ? Math.round(state.progress * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-xl" onEscapeKeyDown={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Upload a {ASSET_KIND_TITLES[kind]}</DialogTitle>
          <DialogDescription>
            The file goes straight to storage. Large videos upload in parts. Limit{' '}
            {formatBytes(ASSET_KIND_RULES[kind].maxBytes)}.
          </DialogDescription>
        </DialogHeader>

        {state.status === 'error' && state.code === 'FEATURE_DISABLED' ? (
          <StorageNotConnected compact />
        ) : (
          <form id={`${inputId}-form`} className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>File</Label>
              <label
                htmlFor={inputId}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!busy) pick(e.dataTransfer.files[0]);
                }}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-tile border-[1.5px] border-dashed border-strong bg-surface-base px-4 py-8 text-center transition-colors',
                  dragging && 'border-joy bg-joy-soft',
                  busy && 'pointer-events-none opacity-60',
                )}
              >
                <Icon icon={file ? FileArrowUp : CloudArrowUp} size={28} className="text-joy-text" />
                {file ? (
                  <span className="text-sm font-semibold text-ink">
                    {file.name} · {formatBytes(file.size)}
                  </span>
                ) : (
                  <span className="text-sm text-muted">Drop a file here, or click to choose one</span>
                )}
              </label>
              <input
                id={inputId}
                type="file"
                className="sr-only"
                accept={acceptFor(kind)}
                disabled={busy}
                aria-invalid={fileError ? true : undefined}
                aria-describedby={fileError ? `${inputId}-error` : undefined}
                onChange={(e) => pick(e.target.files?.[0])}
              />
              {fileError ? (
                <p id={`${inputId}-error`} role="alert" className="text-xs font-medium text-danger-text">
                  {fileError}
                </p>
              ) : null}
            </div>

            {kind !== 'caption' ? (
              <Field label="Ratio">
                <Select value={ratio ?? undefined} onValueChange={(v) => setRatio(v as Ratio)} disabled={busy}>
                  <SelectTrigger aria-label="Ratio">
                    <SelectValue placeholder="Choose a ratio" />
                  </SelectTrigger>
                  <SelectContent>
                    {ratios.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            {hasLoudness(kind) ? (
              <Field
                label="Loudness (LUFS)"
                hint={`Optional. Measured on the final mix. Target ${LOUDNESS_TARGET_LUFS} LUFS.`}
                error={lufsError ?? undefined}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  step={0.1}
                  min={-70}
                  max={0}
                  placeholder={String(LOUDNESS_TARGET_LUFS)}
                  value={lufs}
                  disabled={busy}
                  onChange={(e) => {
                    setLufs(e.target.value);
                    setLufsError(null);
                  }}
                />
              </Field>
            ) : null}

            <Field label="Licence" hint="For music, footage or fonts. For example: Licensed track, commercial use.">
              <Input value={licence} onChange={(e) => setLicence(e.target.value)} maxLength={300} disabled={busy} />
            </Field>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id={`${inputId}-consent`}
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  disabled={busy}
                />
                <Label htmlFor={`${inputId}-consent`} className="font-medium">
                  Consent on file for every face
                </Label>
              </div>
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id={`${inputId}-ai`}
                  checked={aiGenerated}
                  onCheckedChange={(v) => setAiGenerated(v === true)}
                  disabled={busy}
                />
                <Label htmlFor={`${inputId}-ai`} className="font-medium">
                  People or voices in it are AI generated (AI label goes on)
                </Label>
              </div>
            </div>

            {state.status === 'uploading' ? (
              <div className="flex flex-col gap-1.5">
                <div
                  role="progressbar"
                  aria-label={`Uploading ${state.fileName}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  className="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
                >
                  <div className="h-full rounded-pill bg-joy transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-muted" aria-live="polite">
                  Uploading {progress}%
                </p>
              </div>
            ) : null}
            {state.status === 'error' ? (
              <p role="alert" className="text-sm font-medium text-danger-text">
                {state.message}
              </p>
            ) : null}
            {state.status === 'cancelled' ? (
              <p className="text-sm text-muted" aria-live="polite">
                Upload cancelled. Nothing was kept.
              </p>
            ) : null}
          </form>
        )}

        <DialogFooter>
          {busy ? (
            <Button variant="secondary" onClick={upload.cancel}>
              Cancel upload
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button type="submit" form={`${inputId}-form`} loading={busy} disabled={Boolean(fileError) || !file}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
