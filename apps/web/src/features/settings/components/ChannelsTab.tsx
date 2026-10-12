/**
 * Channels tab: which connected accounts this product posts to, with default languages and
 * ratio. Placeholder design until Jeeva designs Settings.
 */
import { ShareNetwork } from '@phosphor-icons/react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  RATIOS,
  type ChannelStatus,
  type Language,
  type ProductChannelInput,
  type ProductChannelView,
  type ProductSettingsDetail,
  type Ratio,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useProductChannels, useReplaceChannels } from '../api';
import { errorToast } from '../format';
import { ChipToggle, PlatformBadge, ReadOnlyNote, SaveBar, TabSkeleton } from './shared';
import { useDraft, useReportDirty } from '../draft';

const STATUS: Record<ChannelStatus, { tone: StatusTone; label: string }> = {
  connected: { tone: 'care', label: 'Connected' },
  needs_approval: { tone: 'joy', label: 'Needs API approval' },
  manual: { tone: 'reminder', label: 'By hand' },
  disconnected: { tone: 'neutral', label: 'Not connected' },
  error: { tone: 'danger', label: 'Error' },
};
const ANY_RATIO = '__any__';

type Row = ProductChannelInput;

const toRow = (c: ProductChannelView): Row => ({
  channelAccountId: c.channelAccountId,
  enabled: c.enabled,
  defaultLanguages: c.defaultLanguages,
  defaultRatio: c.defaultRatio,
});

export function ChannelsTab({
  productId,
  settings,
}: {
  productId: string;
  settings: ProductSettingsDetail;
}) {
  const canEdit = settings.canEdit;
  const query = useProductChannels(productId);
  const replace = useReplaceChannels(productId);
  const saved = React.useMemo(() => (query.data?.items ?? []).map(toRow), [query.data]);
  const { draft: rows, setDraft: setRows, dirty, reset } = useDraft<Row[]>(saved);
  useReportDirty('channels', dirty);

  if (query.isPending) return <TabSkeleton />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );

  const accounts = query.data.items;
  const patch = (id: string, p: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.channelAccountId === id ? { ...r, ...p } : r)));

  async function save() {
    // Only rows the user turned on or configured are stored; untouched, off rows stay unset.
    const configured = new Set(accounts.filter((a) => a.configured).map((a) => a.channelAccountId));
    const body = rows.filter(
      (r) =>
        r.enabled ||
        configured.has(r.channelAccountId) ||
        r.defaultLanguages.length > 0 ||
        r.defaultRatio,
    );
    try {
      await replace.mutateAsync(body);
      reset();
      toast.success('Channels saved');
    } catch (error) {
      toast.error(...errorToast(error, 'Channels not saved'));
    }
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={ShareNetwork}
        title="No channel accounts yet"
        description="Connect Instagram, YouTube, Facebook or LinkedIn first. Then choose here which ones this product posts to."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/integrations">Open Integrations</Link>
          </Button>
        }
      />
    );
  }

  const disabled = !canEdit || replace.isPending;

  return (
    <div className="flex flex-col gap-4">
      <ReadOnlyNote show={!canEdit} />
      <Panel
        title="Channels"
        description="Accounts this product posts to, with the default caption languages and video ratio."
      >
        <ul className="flex flex-col divide-y divide-hairline" aria-label="Channel accounts">
          {accounts.map((a) => {
            const row = rows.find((r) => r.channelAccountId === a.channelAccountId) ?? toRow(a);
            const status = STATUS[a.status];
            return (
              <li
                key={a.channelAccountId}
                className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[minmax(0,1.3fr)_auto_minmax(0,1fr)_160px] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <PlatformBadge platform={a.platform} showLabel={false} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{a.displayName}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <StatusChip tone={status.tone} dot>
                        {status.label}
                      </StatusChip>
                      {a.handle ? <span>{a.handle}</span> : null}
                      {a.shared ? <span>Shared by all products</span> : null}
                    </p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-13 font-medium text-ink">
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => patch(a.channelAccountId, { enabled: v })}
                    disabled={disabled}
                    aria-label={`Post ${a.displayName} for this product`}
                  />
                  Use
                </label>
                <div
                  className="flex flex-wrap items-center gap-2"
                  role="group"
                  aria-label={`Default languages for ${a.displayName}`}
                >
                  {LANGUAGES.map((lang: Language) => (
                    <ChipToggle
                      key={lang}
                      pressed={row.defaultLanguages.includes(lang)}
                      disabled={disabled}
                      onPressedChange={(on) =>
                        patch(a.channelAccountId, {
                          defaultLanguages: on
                            ? LANGUAGES.filter(
                                (l) => l === lang || row.defaultLanguages.includes(l),
                              )
                            : row.defaultLanguages.filter((l) => l !== lang),
                        })
                      }
                    >
                      {LANGUAGE_LABELS[lang]}
                    </ChipToggle>
                  ))}
                </div>
                <Select
                  value={row.defaultRatio ?? ANY_RATIO}
                  onValueChange={(v) =>
                    patch(a.channelAccountId, {
                      defaultRatio: v === ANY_RATIO ? null : (v as Ratio),
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger aria-label={`Default ratio for ${a.displayName}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_RATIO}>Any ratio</SelectItem>
                    {RATIOS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      </Panel>
      <SaveBar
        dirty={dirty}
        saving={replace.isPending}
        onSave={() => void save()}
        onDiscard={reset}
        disabled={!canEdit}
      />
    </div>
  );
}
