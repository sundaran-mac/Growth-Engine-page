/**
 * Claude and weekly run tab: weekly run on/off, day, time, ideas count, modes, monthly token
 * cap with usage, GitHub pull request settings, "Run now" and the run history.
 * Placeholder design until Jeeva designs Settings.
 */
import { ArrowSquareOut, Play, Sparkle } from '@phosphor-icons/react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CONTENT_MODES,
  CONTENT_MODE_LABELS,
  WEEKDAY_LABELS,
  type ProductSettingsDetail,
  type WeeklyRun,
  type WeeklyRunStatus,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Input } from '@/components/atoms/Input';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { ConfirmDialog } from '@/components/molecules/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { Panel } from '@/components/organisms/Panel';
import { Switch } from '@/components/ui/switch';
import { useRunNow, useWeeklyRuns } from '../api';
import { errorToast, formatDateTime, formatTokens } from '../format';
import { useSettingsDraft } from '../use-settings-draft';
import { FieldError } from './GeneralTab';
import { MemoryPanel } from './MemoryPanel';
import { ChipToggle, ReadOnlyNote, SaveBar, SettingRow, WeekdaySelect } from './shared';

const KEYS = [
  'weeklyRunEnabled',
  'weeklyRunDay',
  'weeklyRunTime',
  'weeklyIdeasCount',
  'weeklyModes',
  'claudeMonthlyTokenCap',
  'weeklyPrEnabled',
  'githubRepo',
  'githubBaseBranch',
] as const;

const RUN_STATUS: Record<WeeklyRunStatus, { tone: StatusTone; label: string }> = {
  queued: { tone: 'neutral', label: 'Queued' },
  running: { tone: 'joy', label: 'Running' },
  done: { tone: 'care', label: 'Done' },
  failed: { tone: 'danger', label: 'Failed' },
  skipped: { tone: 'neutral', label: 'Skipped' },
};

export function ClaudeTab({
  productId,
  settings,
}: {
  productId: string;
  settings: ProductSettingsDetail;
}) {
  const canEdit = settings.canEdit;
  const form = useSettingsDraft(settings, KEYS, 'claude');
  const runs = useWeeklyRuns(productId);
  const runNow = useRunNow(productId);
  const [confirmRun, setConfirmRun] = React.useState(false);
  const d = form.draft;
  const disabled = !canEdit || form.saving;
  const usage = settings.claudeUsage;
  const pct =
    usage.capTokens > 0 ? Math.min(100, Math.round((usage.usedTokens / usage.capTokens) * 100)) : 0;
  const busy =
    runs.data?.items.some((r) => r.status === 'queued' || r.status === 'running') ?? false;

  const columns: DataTableColumn<WeeklyRun>[] = [
    {
      id: 'when',
      header: 'When',
      cell: (r) => (
        <div className="flex flex-col">
          <span className="text-13 font-medium text-ink">
            {formatDateTime(r.startedAt ?? r.createdAt)}
          </span>
          <span className="text-xs text-muted">Week of {r.weekStart}</span>
        </div>
      ),
    },
    {
      id: 'trigger',
      header: 'Started by',
      cell: (r) =>
        r.triggeredBy === 'schedule' ? 'Schedule' : (r.triggeredByUser?.name ?? 'Run now'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => (
        <StatusChip tone={RUN_STATUS[r.status].tone} dot>
          {RUN_STATUS[r.status].label}
        </StatusChip>
      ),
    },
    { id: 'ideas', header: 'Ideas', align: 'right', cell: (r) => r.ideasCreated },
    {
      id: 'pr',
      header: 'Pull request',
      cell: (r) =>
        r.githubPrUrl ? (
          <a
            href={r.githubPrUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-2"
          >
            Open PR <ArrowSquareOut size={14} aria-hidden="true" />
          </a>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
    {
      id: 'note',
      header: 'Error or note',
      className: 'max-w-[280px]',
      cell: (r) =>
        r.error ? (
          <span
            className={
              r.status === 'failed' ? 'text-xs font-medium text-danger-text' : 'text-xs text-muted'
            }
          >
            {r.error}
          </span>
        ) : (
          <span className="text-muted">None</span>
        ),
    },
  ];

  async function startRun() {
    try {
      await runNow.mutateAsync();
      toast.success('Weekly run started', {
        description: 'Ideas, review, Monday note, then the pull request.',
      });
    } catch (error) {
      toast.error(...errorToast(error, 'Run not started'));
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      {!settings.features.claude ? (
        <p className="rounded-tile bg-joy-soft px-4 py-3 text-13 text-joy-text">
          Claude is not connected, so weekly runs are skipped and summaries are not written.{' '}
          <Link to="/integrations" className="font-semibold underline underline-offset-2">
            Open Integrations
          </Link>
        </p>
      ) : null}

      <Panel
        title="Weekly run"
        titleIcon={<Sparkle size={18} aria-hidden="true" className="text-joy" />}
        description="Claude drafts ideas, reviews open ones and writes the Monday note. Claude never approves."
      >
        <SettingRow title="Run every week">
          <Switch
            checked={d.weeklyRunEnabled}
            onCheckedChange={(v) => form.set('weeklyRunEnabled', v)}
            disabled={disabled}
            aria-label="Run every week"
          />
        </SettingRow>
        <SettingRow
          title="Day and time"
          help={`In the product time zone (${settings.timezone.replace(/_/g, ' ')}).`}
          htmlFor="cl-day"
        >
          <div className="flex flex-wrap gap-2">
            <WeekdaySelect
              id="cl-day"
              value={d.weeklyRunDay}
              onChange={(v) => form.set('weeklyRunDay', v)}
              disabled={disabled || !d.weeklyRunEnabled}
              className="w-36"
            />
            <Input
              type="time"
              aria-label="Run time"
              value={d.weeklyRunTime}
              onChange={(e) => form.set('weeklyRunTime', e.target.value.slice(0, 5))}
              disabled={disabled || !d.weeklyRunEnabled}
              className="w-36"
              aria-invalid={form.errors.weeklyRunTime ? true : undefined}
            />
          </div>
          {form.errors.weeklyRunTime ? <FieldError text={form.errors.weeklyRunTime} /> : null}
        </SettingRow>
        <SettingRow title="Ideas per run" help="1 to 30." htmlFor="cl-count">
          <Input
            id="cl-count"
            type="number"
            min={1}
            max={30}
            value={d.weeklyIdeasCount}
            onChange={(e) => form.set('weeklyIdeasCount', Number(e.target.value))}
            disabled={disabled}
            className="w-28"
            aria-invalid={form.errors.weeklyIdeasCount ? true : undefined}
          />
          {form.errors.weeklyIdeasCount ? <FieldError text={form.errors.weeklyIdeasCount} /> : null}
        </SettingRow>
        <SettingRow title="Content modes" help="None chosen means all modes.">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Content modes">
            {CONTENT_MODES.map((m) => (
              <ChipToggle
                key={m}
                pressed={d.weeklyModes.includes(m)}
                disabled={disabled}
                onPressedChange={(on) =>
                  form.set(
                    'weeklyModes',
                    on
                      ? CONTENT_MODES.filter((x) => x === m || d.weeklyModes.includes(x))
                      : d.weeklyModes.filter((x) => x !== m),
                  )
                }
              >
                {m} {CONTENT_MODE_LABELS[m]}
              </ChipToggle>
            ))}
          </div>
        </SettingRow>
        <SettingRow
          title="Monthly token cap"
          help="Empty uses the default cap. 0 means no cap."
          htmlFor="cl-cap"
        >
          <div className="flex flex-col gap-2">
            <Input
              id="cl-cap"
              type="number"
              min={0}
              step={10000}
              value={d.claudeMonthlyTokenCap ?? ''}
              placeholder="Default"
              onChange={(e) =>
                form.set(
                  'claudeMonthlyTokenCap',
                  e.target.value === '' ? null : Number(e.target.value),
                )
              }
              disabled={disabled}
              className="w-44"
              aria-invalid={form.errors.claudeMonthlyTokenCap ? true : undefined}
            />
            {form.errors.claudeMonthlyTokenCap ? (
              <FieldError text={form.errors.claudeMonthlyTokenCap} />
            ) : null}
            <div className="flex flex-col gap-1">
              <div
                className="h-2 w-full max-w-sm overflow-hidden rounded-pill bg-surface-sunken"
                role="progressbar"
                aria-label="Claude tokens used this month"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className={
                    pct >= 90 ? 'h-full rounded-pill bg-danger' : 'h-full rounded-pill bg-joy'
                  }
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted">
                {formatTokens(usage.usedTokens)} of{' '}
                {usage.capTokens > 0 ? formatTokens(usage.capTokens) : 'no cap'} tokens used in{' '}
                {usage.month}.
              </p>
            </div>
          </div>
        </SettingRow>
      </Panel>

      <Panel
        title="GitHub pull request"
        description="Each run can open a pull request with docs/growth/weekly/<date>.md in the product repo."
      >
        {!settings.features.github ? (
          <p className="rounded-tile bg-surface-sunken px-4 py-3 text-13 text-muted">
            GitHub is not connected. Runs still finish and record "PR skipped: GitHub not
            connected".
          </p>
        ) : null}
        <SettingRow title="Open a pull request">
          <Switch
            checked={d.weeklyPrEnabled}
            onCheckedChange={(v) => form.set('weeklyPrEnabled', v)}
            disabled={disabled}
            aria-label="Open a weekly pull request"
          />
        </SettingRow>
        <SettingRow
          title="Repo"
          help="owner/name, for example humini-ecosystem/humini-live-app."
          htmlFor="cl-repo"
        >
          <Input
            id="cl-repo"
            value={d.githubRepo ?? ''}
            placeholder="owner/name"
            onChange={(e) =>
              form.set('githubRepo', e.target.value.trim() === '' ? null : e.target.value.trim())
            }
            disabled={disabled}
            aria-invalid={form.errors.githubRepo ? true : undefined}
          />
          {form.errors.githubRepo ? <FieldError text={form.errors.githubRepo} /> : null}
        </SettingRow>
        <SettingRow title="Base branch" htmlFor="cl-branch">
          <Input
            id="cl-branch"
            value={d.githubBaseBranch}
            onChange={(e) => form.set('githubBaseBranch', e.target.value)}
            disabled={disabled}
            className="max-w-xs"
            aria-invalid={form.errors.githubBaseBranch ? true : undefined}
          />
          {form.errors.githubBaseBranch ? <FieldError text={form.errors.githubBaseBranch} /> : null}
        </SettingRow>
      </Panel>

      <MemoryPanel />

      <Panel
        title="Run history"
        description={
          d.weeklyRunEnabled
            ? `Next scheduled run: ${WEEKDAY_LABELS[settings.weeklyRunDay]} at ${settings.weeklyRunTime}.`
            : 'Weekly runs are off. You can still run it by hand.'
        }
        flush
        actions={
          canEdit ? (
            <Button
              size="sm"
              leftIcon={Play}
              onClick={() => setConfirmRun(true)}
              disabled={busy || runNow.isPending}
              loading={runNow.isPending}
            >
              {busy ? 'Running' : 'Run now'}
            </Button>
          ) : null
        }
      >
        <div className="px-2 pb-4">
          <DataTable
            caption="Weekly runs of this product"
            columns={columns}
            rows={runs.data?.items}
            getRowId={(r) => r.id}
            loading={runs.isPending}
            error={runs.error}
            onRetry={() => void runs.refetch()}
            empty="No runs yet."
          />
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title="Run the weekly run now?"
        description="Claude drafts new ideas, reviews open ideas and writes the Monday note. It uses Claude tokens from this month's budget."
        confirmLabel="Run now"
        onConfirm={startRun}
      />
      <SaveBar
        dirty={form.dirty}
        saving={form.saving}
        onSave={() => void form.save()}
        onDiscard={form.discard}
        disabled={!canEdit}
      />
    </div>
  );
}
