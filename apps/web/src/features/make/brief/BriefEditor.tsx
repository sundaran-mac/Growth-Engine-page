import { CaretDown, PencilSimple, Snowflake, Sparkle, Warning } from '@phosphor-icons/react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ASSIST_KIND_LABELS,
  ASSIST_KINDS,
  BRIEF_TITLE_MAX,
  isBriefEditable,
  type Brief,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Input } from '@/components/atoms/Input';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { Field } from '@/components/molecules/Field';
import { Page } from '@/components/templates/Page';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { isApiError } from '@/lib/api';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useBriefOptions, useFreezeBrief, useMakeFeatures, useUnfreezeBrief } from '../api';
import { BriefEditorCard } from './BriefEditorCard';
import { BriefFactsRow } from './BriefFactsRow';
import { ClaimCheckPanel } from './ClaimCheckPanel';
import { CowriterPanel } from './CowriterPanel';
import { firstName, isBlocking, modeLongLabel } from './labels';
import { StageTracker } from './StageTracker';
import { useBriefAutosave, type AutosaveStatus } from './use-brief-autosave';
import { useCowriter } from './use-cowriter';
import { useLiveClaimCheck } from './use-live-claim-check';
import { MemoryMatches } from '@/features/ideas/components/MemoryMatches';
import { useLiveMemoryCheck } from '@/features/ideas/memory';

const statusText: Record<AutosaveStatus, string> = {
  idle: 'All changes saved',
  dirty: 'Not saved yet',
  saving: 'Saving...',
  saved: 'Saved',
  error: 'Not saved',
  conflict: 'Not saved',
};

function SaveStatus({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted">
      {status === 'error' ? <Warning size={14} className="text-danger-text" aria-hidden="true" /> : null}
      <span className={status === 'error' ? 'text-danger-text' : undefined}>{statusText[status]}</span>
      {status === 'error' ? (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </p>
  );
}

function freezeBlockReason(opts: {
  stage: Brief['stage'];
  blocking: boolean;
  unsaved: boolean;
  hook: string | null;
  beats: string[];
}): string | null {
  if (opts.stage !== 'brief') return 'Only a brief in the Brief stage can be frozen.';
  if (opts.blocking) return 'Fix the red flags in the claim check first.';
  if (opts.unsaved) return 'Wait until your changes are saved.';
  if (!opts.hook?.trim() || opts.beats.every((b) => !b.trim())) return 'Write a hook and at least one beat first.';
  return null;
}

/** Brief screen body (Figma 240:1314). Mount with `key={brief.id}`. */
/** Where a locked brief goes next, so every stage has a clear way forward. */
const NEXT_STEP: Partial<Record<string, { label: string; to: (id: string) => string }>> = {
  frozen: { label: 'Open in Studio', to: (id) => `/studio/${id}` },
  made: { label: 'Open in Studio', to: (id) => `/studio/${id}` },
  reviewed: { label: 'Open review', to: (id) => `/review/${id}` },
  approved: { label: 'Open publish', to: (id) => `/publish/${id}` },
  scheduled: { label: 'Open publish', to: (id) => `/publish/${id}` },
  live: { label: 'Open publish', to: (id) => `/publish/${id}` },
};

export function BriefEditor({ brief }: { brief: Brief }) {
  const editable = isBriefEditable(brief.stage);
  const autosave = useBriefAutosave(brief, { enabled: editable });
  const { values } = autosave;
  const live = useLiveClaimCheck(
    brief.id,
    { title: values.title, hook: values.hook, beats: values.beats, ask: values.ask },
    { enabled: editable },
  );
  // Content memory: warn while typing when the hook repeats earlier content (any product).
  const memory = useLiveMemoryCheck(
    editable && values.hook?.trim()
      ? { productId: brief.productId, kind: 'brief_hook', title: values.title, body: values.hook, excludeBriefId: brief.id }
      : null,
  );
  const flags = live.result?.flags ?? brief.claimFlags;
  const blocking = live.result ? live.result.blocking : isBlocking(flags);
  const options = useBriefOptions(editable ? brief.id : undefined);
  const features = useMakeFeatures();
  const claudeEnabled = features.data?.claude ?? true;
  const cowriter = useCowriter(brief.id, values, autosave.update);
  const freeze = useFreezeBrief(brief.id);
  const unfreeze = useUnfreezeBrief(brief.id);
  const { products } = useSelectedProduct();
  const productName = products.find((p) => p.id === brief.productId)?.name ?? 'Product';

  const [confirmFreeze, setConfirmFreeze] = React.useState(false);
  const [confirmUnfreeze, setConfirmUnfreeze] = React.useState(false);
  const [confirmReload, setConfirmReload] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState(values.title);

  const reason = freezeBlockReason({
    stage: brief.stage,
    blocking,
    unsaved: autosave.hasUnsaved || autosave.status === 'conflict',
    hook: values.hook,
    beats: values.beats,
  });

  async function doFreeze() {
    try {
      const b = await freeze.mutateAsync(brief.version);
      toast.success(`${b.code} is frozen`, { description: 'The Studio can start making it.' });
    } catch (err) {
      const msg = isApiError(err) ? err : null;
      toast.error(msg?.title ?? 'Could not freeze', {
        description: msg?.detail ?? (msg?.code === 'CLAIM_CHECK_FAILED' ? 'Fix the red flags first.' : 'Please try again.'),
      });
      throw err;
    }
  }

  async function doUnfreeze() {
    try {
      await unfreeze.mutateAsync(brief.version);
      toast.success('Back to Brief. You can edit again.');
    } catch (err) {
      toast.error(isApiError(err) ? err.title : 'Could not unfreeze', {
        ...(isApiError(err) && err.detail ? { description: err.detail } : {}),
      });
      throw err;
    }
  }

  const ownerFirst = firstName(brief.owner);
  const subtitle = `Brief · ${productName} · ${modeLongLabel(values.mode)}${ownerFirst ? ` · owner: ${ownerFirst}` : ''}`;

  return (
    <Page
      title={`${brief.code} · ${values.title}`}
      subtitle={subtitle}
      actions={
        <>
          {editable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" rightIcon={CaretDown} loading={cowriter.pendingKind !== null}>
                  Ask Claude
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {ASSIST_KINDS.map((k) => (
                  <DropdownMenuItem key={k} disabled={!claudeEnabled} onSelect={() => void cowriter.ask(k)}>
                    <Sparkle size={16} aria-hidden="true" />
                    {ASSIST_KIND_LABELS[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {brief.stage === 'frozen' ? (
            <Button variant="secondary" onClick={() => setConfirmUnfreeze(true)}>
              Unfreeze
            </Button>
          ) : (
            <Button
              leftIcon={Snowflake}
              disabled={reason !== null}
              aria-describedby={reason ? 'freeze-reason' : undefined}
              onClick={() => setConfirmFreeze(true)}
            >
              Freeze brief
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StageTracker stage={brief.stage} />
        <StatusChip tone="neutral" title={`Version ${brief.version}`}>
          v{brief.version}
        </StatusChip>
        {editable ? (
          <IconButton
            icon={PencilSimple}
            label="Rename brief"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTitleDraft(values.title);
              setRenaming(true);
            }}
          />
        ) : null}
        <div className="ml-auto flex flex-col items-end gap-0.5">
          {editable ? <SaveStatus status={autosave.status} onRetry={() => void autosave.flush()} /> : null}
          {reason && brief.stage === 'brief' ? (
            <p id="freeze-reason" className="text-xs text-muted">
              {reason}
            </p>
          ) : null}
        </div>
      </div>

      {autosave.status === 'conflict' ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-tile border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Warning size={18} aria-hidden="true" />
          <p className="flex-1">
            <span className="font-semibold">Someone else changed this brief.</span> Your last edits are not saved. Reload to see their version.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setConfirmReload(true)}>
            Reload
          </Button>
        </div>
      ) : null}

      {!editable ? (
        <div className="flex flex-wrap items-center gap-3 rounded-tile bg-surface-sunken px-4 py-3 text-13 text-ink">
          <p className="flex-1">
            This brief is {brief.stage}. The script is locked.
            {brief.stage === 'frozen' ? ' Unfreeze it to edit, or make it in the Studio.' : ''}
          </p>
          {NEXT_STEP[brief.stage] ? (
            <Button variant="dark" size="sm" asChild>
              <Link to={NEXT_STEP[brief.stage]!.to(brief.id)}>{NEXT_STEP[brief.stage]!.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-[700_1_0%]">
          <BriefEditorCard
            hook={values.hook}
            beats={values.beats}
            ask={values.ask}
            readOnly={!editable}
            onChange={(p) => autosave.update(p)}
            onFlush={() => void autosave.flush()}
          />
          {memory && memory.status !== 'unique' ? (
            <MemoryMatches
              status={memory.status}
              matches={memory.matches}
              what="hook"
              note={
                memory.status === 'duplicate'
                  ? 'This hook repeats earlier content. A hook that repeats another brief is not saved until you change it.'
                  : 'Close to earlier content. You can keep it, but a new angle is better.'
              }
            />
          ) : null}
          <BriefFactsRow
            values={values}
            readOnly={!editable}
            options={options.data}
            people={{ owner: brief.owner, claimsApprover: brief.claimsApprover, brandApprover: brief.brandApprover }}
            onChange={autosave.update}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-[376_1_0%]">
          <ClaimCheckPanel flags={flags} checking={live.checking} failed={Boolean(live.error)} />
          <CowriterPanel
            cowriter={cowriter}
            suggestions={values.claudeSuggestions}
            editable={editable}
            claudeEnabled={claudeEnabled}
            onUseHook={(hook) => autosave.update({ hook }, { immediate: true })}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmFreeze}
        onOpenChange={setConfirmFreeze}
        title={`Freeze ${brief.code}?`}
        description="Freezing locks the script and hands it to the Studio. You can unfreeze it until it is made."
        confirmLabel="Freeze brief"
        onConfirm={doFreeze}
      />
      <ConfirmDialog
        open={confirmUnfreeze}
        onOpenChange={setConfirmUnfreeze}
        title={`Unfreeze ${brief.code}?`}
        description="The brief goes back to the Brief stage so you can edit it. The claim check runs again before the next freeze."
        confirmLabel="Unfreeze"
        onConfirm={doUnfreeze}
      />
      <ConfirmDialog
        open={confirmReload}
        onOpenChange={setConfirmReload}
        title="Reload this brief?"
        description="Your unsaved edits will be lost. The latest saved version will load."
        confirmLabel="Reload"
        tone="danger"
        onConfirm={autosave.reload}
      />
      <ConfirmDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename brief"
        confirmLabel="Save"
        onConfirm={() => {
          const t = titleDraft.trim();
          if (t && t !== values.title) autosave.update({ title: t }, { immediate: true });
        }}
      >
        <Field label="Title" required>
          <Input value={titleDraft} maxLength={BRIEF_TITLE_MAX} onChange={(e) => setTitleDraft(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </Page>
  );
}
