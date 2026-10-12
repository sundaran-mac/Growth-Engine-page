import { DotsThreeVertical, Plus } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { toast } from 'sonner';
import {
  canMoveRenderJob,
  RENDER_JOB_KINDS,
  type RenderJob,
  type RenderJobKind,
  type RenderJobStatus,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { IconButton } from '@/components/atoms/IconButton';
import { Input } from '@/components/atoms/Input';
import { StatusChip } from '@/components/atoms/StatusChip';
import { ErrorState, errorMessage } from '@/components/molecules/ErrorState';
import { Field } from '@/components/molecules/Field';
import { DURATION, EASE } from '@/components/motion';
import { Panel } from '@/components/organisms/Panel';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateRenderJob, useRenderJobs, useUpdateRenderJob } from '../api';
import { RENDER_KIND_LABELS, renderJobChip } from './helpers';

type DialogKind =
  { type: 'add' } | { type: 'progress'; job: RenderJob } | { type: 'fail'; job: RenderJob } | null;

export interface RenderJobsCardProps {
  briefId: string;
  canEdit: boolean;
}

/** Render jobs as hand-off records a maker updates by hand (Figma 241:1153). */
export function RenderJobsCard({ briefId, canEdit }: RenderJobsCardProps) {
  const jobs = useRenderJobs(briefId);
  const update = useUpdateRenderJob(briefId);
  const [dialog, setDialog] = React.useState<DialogKind>(null);

  function move(
    job: RenderJob,
    status: RenderJobStatus,
    extra: { progress?: number; error?: string | null } = {},
  ) {
    update.mutate(
      { id: job.id, status, ...extra },
      {
        onSuccess: () =>
          toast.success(
            `${job.label}: ${renderJobChip({ status, progress: extra.progress ?? job.progress }).label}`,
          ),
        onError: (err) =>
          toast.error('Could not update the job', { description: errorMessage(err).detail }),
      },
    );
  }

  return (
    <Panel
      title={<span className="text-base">Render jobs</span>}
      aria-busy={jobs.isPending || undefined}
      className="min-w-0 flex-1"
      actions={
        canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Plus}
            onClick={() => setDialog({ type: 'add' })}
          >
            Add job
          </Button>
        ) : null
      }
    >
      {jobs.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : jobs.isError ? (
        <ErrorState
          error={jobs.error}
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        />
      ) : jobs.data.items.length === 0 ? (
        <p className="text-13 text-muted">
          No render jobs yet. Add one when a render, voice, mix or cut-down starts.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence>
            {jobs.data.items.map((job) => {
              const chip = renderJobChip(job);
              const can = (to: RenderJobStatus) => canEdit && canMoveRenderJob(job.status, to);
              const hasActions = canEdit && job.status !== 'done';
              return (
                <motion.li
                  key={job.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION.base, ease: EASE }}
                  className="flex min-h-[23px] items-center gap-2"
                >
                  {/* Figma 241:1155: one 13px line per job; the tool name sits in the tooltip. */}
                  <div
                    className="min-w-0 flex-1"
                    title={job.tool ? `Runs in ${job.tool}` : undefined}
                  >
                    <p className="truncate text-13 text-ink">
                      {job.label}
                      {job.tool ? <span className="sr-only"> (runs in {job.tool})</span> : null}
                    </p>
                    {job.status === 'failed' && job.error ? (
                      <p className="truncate text-xs text-danger-text">{job.error}</p>
                    ) : null}
                  </div>
                  <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                  {hasActions ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          icon={DotsThreeVertical}
                          label={`Update ${job.label}`}
                          variant="ghost"
                          size="sm"
                          tooltip={false}
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {job.status === 'queued' ? (
                          <DropdownMenuItem onSelect={() => move(job, 'running', { progress: 0 })}>
                            Mark running
                          </DropdownMenuItem>
                        ) : null}
                        {job.status === 'running' ? (
                          <DropdownMenuItem onSelect={() => setDialog({ type: 'progress', job })}>
                            Set progress
                          </DropdownMenuItem>
                        ) : null}
                        {can('done') ? (
                          <DropdownMenuItem onSelect={() => move(job, 'done', { progress: 100 })}>
                            Mark done
                          </DropdownMenuItem>
                        ) : null}
                        {can('failed') ? (
                          <DropdownMenuItem
                            destructive
                            onSelect={() => setDialog({ type: 'fail', job })}
                          >
                            Mark failed
                          </DropdownMenuItem>
                        ) : null}
                        {can('cancelled') ? (
                          <DropdownMenuItem onSelect={() => move(job, 'cancelled')}>
                            Cancel job
                          </DropdownMenuItem>
                        ) : null}
                        {can('queued') ? (
                          <DropdownMenuItem
                            onSelect={() => move(job, 'queued', { progress: 0, error: null })}
                          >
                            Retry
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {/* Dialogs mount only while open, so each opens with fresh fields. */}
      {dialog?.type === 'add' ? (
        <AddJobDialog briefId={briefId} open onOpenChange={(o) => !o && setDialog(null)} />
      ) : null}
      {dialog?.type === 'progress' ? (
        <ProgressDialog
          key={dialog.job.id}
          job={dialog.job}
          onClose={() => setDialog(null)}
          onSave={(job, progress) => move(job, 'running', { progress })}
        />
      ) : null}
      {dialog?.type === 'fail' ? (
        <FailDialog
          key={dialog.job.id}
          job={dialog.job}
          onClose={() => setDialog(null)}
          onSave={(job, error) => move(job, 'failed', { error })}
        />
      ) : null}
    </Panel>
  );
}

function AddJobDialog({
  briefId,
  open,
  onOpenChange,
}: {
  briefId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateRenderJob(briefId);
  const [kind, setKind] = React.useState<RenderJobKind>('render');
  const [label, setLabel] = React.useState('');
  const [tool, setTool] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      setError('Give the job a short label, for example "Render 1080x1350 · 30 fps".');
      return;
    }
    create.mutate(
      { kind, label: label.trim(), tool: tool.trim() || null },
      {
        onSuccess: () => {
          toast.success('Render job added');
          onOpenChange(false);
        },
        onError: (err) => setError(errorMessage(err).detail ?? errorMessage(err).title),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a render job</DialogTitle>
        </DialogHeader>
        <form id="add-render-job" className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <Field label="Kind">
            <Select value={kind} onValueChange={(v) => setKind(v as RenderJobKind)}>
              <SelectTrigger aria-label="Kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RENDER_JOB_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {RENDER_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Label" required error={error ?? undefined}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Tool" hint="Where it runs, for example reel-studio, capcut or figma.">
            <Input value={tool} onChange={(e) => setTool(e.target.value)} maxLength={60} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-render-job" loading={create.isPending}>
            Add job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressDialog({
  job,
  onClose,
  onSave,
}: {
  job: RenderJob | null;
  onClose: () => void;
  onSave: (job: RenderJob, progress: number) => void;
}) {
  const [value, setValue] = React.useState(String(job?.progress ?? 0));
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <Dialog open={job !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set progress</DialogTitle>
        </DialogHeader>
        <Field
          label="Progress (0 to 100)"
          error={valid ? undefined : 'Use a whole number from 0 to 100.'}
        >
          <Input
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              if (job && valid) onSave(job, n);
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FailDialog({
  job,
  onClose,
  onSave,
}: {
  job: RenderJob | null;
  onClose: () => void;
  onSave: (job: RenderJob, error: string) => void;
}) {
  const [text, setText] = React.useState('');
  return (
    <Dialog open={job !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark job failed</DialogTitle>
        </DialogHeader>
        <Field label="What went wrong" required>
          <Input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!text.trim()}
            onClick={() => {
              if (job && text.trim()) onSave(job, text.trim());
              onClose();
            }}
          >
            Mark failed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
