import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  DotsThreeVertical,
  DownloadSimple,
  PaperPlaneTilt,
  PencilSimple,
  XCircle,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import type { BriefKind, PostStatus, PostView } from '@growth-desk/contract';
import { Icon, type IconComponent } from '@/components/atoms/Icon';
import { IconButton } from '@/components/atoms/IconButton';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { DURATION, EASE } from '@/components/motion';
import type { DataTableColumn } from '@/components/organisms/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  channelLabel,
  formatWhen,
  howLabel,
  howTone,
  languagesLabel,
  viewerTimeZone,
  zoneAbbr,
} from './format';
import { DataTable } from '@/components/organisms/DataTable';
import { PlatformIcon } from './PlatformIcon';
import { rowActions, type RowAction } from './rows';

export type { RowAction };

const STATUS: Record<PostStatus, { label: string; tone: StatusTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'scheduled' },
  publishing: { label: 'Publishing', tone: 'dark' },
  published: { label: 'Published', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  manual_pending: { label: 'Reminder set', tone: 'reminder' },
};

/** Status pill for one post. Cross-fades when the status changes (not on first render). */
export function PostStatusChip({ status }: { status: PostStatus }) {
  const s = STATUS[status];
  return (
    <span className="inline-grid">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={status}
          className="col-start-1 row-start-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DURATION.base, ease: EASE }}
        >
          <StatusChip tone={s.tone} dot={status === 'publishing'}>
            {s.label}
          </StatusChip>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const ACTION_META: Record<RowAction, { label: string; icon: IconComponent }> = {
  edit: { label: 'Edit time and caption', icon: PencilSimple },
  'post-now': { label: 'Post now', icon: PaperPlaneTilt },
  retry: { label: 'Retry', icon: ArrowClockwise },
  cancel: { label: 'Cancel', icon: XCircle },
  download: { label: 'Download file', icon: DownloadSimple },
  'mark-posted': { label: 'Mark as posted', icon: CheckCircle },
};

export interface PublishRowsTableProps {
  posts: PostView[] | undefined;
  briefKind: BriefKind | undefined;
  gateAllowed: boolean;
  loading?: boolean;
  error?: unknown;
  onRetryLoad?: () => void;
  selectedId?: string | null;
  onSelect?: (post: PostView) => void;
  onAction: (post: PostView, action: RowAction) => void;
}

/** CHANNEL, FORMAT, LANGUAGE, WHEN (AUDIENCE TIME), HOW rows from Figma 242:1131, plus status and actions. */
export function PublishRowsTable({
  posts,
  briefKind,
  gateAllowed,
  loading = false,
  error,
  onRetryLoad,
  selectedId,
  onSelect,
  onAction,
}: PublishRowsTableProps) {
  const viewerTz = viewerTimeZone();

  const columns: DataTableColumn<PostView>[] = [
    {
      id: 'icon',
      header: <span className="sr-only">Platform</span>,
      className: 'w-[58px]',
      headClassName: 'w-[58px]',
      cell: (p) => <PlatformIcon platform={p.platform} />,
    },
    {
      id: 'channel',
      headClassName: 'w-[200px]',
      header: 'CHANNEL',
      cell: (p) => (
        <span className="text-sm font-semibold text-ink">
          {channelLabel(p.platform, briefKind, p.channel.displayName)}
        </span>
      ),
    },
    {
      id: 'format',
      headClassName: 'w-[130px]',
      header: 'FORMAT',
      cell: (p) => (
        <span className="whitespace-nowrap text-13">{p.format ?? p.asset?.ratio ?? '-'}</span>
      ),
    },
    {
      id: 'language',
      headClassName: 'w-[120px]',
      header: 'LANGUAGE',
      cell: (p) => <span className="text-13">{languagesLabel(p.languages)}</span>,
    },
    {
      id: 'when',
      headClassName: 'w-[230px]',
      header: 'WHEN (AUDIENCE TIME)',
      cell: (p) => {
        if (!p.scheduledAt) return <span className="text-13 text-muted">Not set</span>;
        const audience = formatWhen(p.scheduledAt, p.audienceTz);
        const at = new Date(p.scheduledAt);
        const showViewer = zoneAbbr(at, viewerTz) !== zoneAbbr(at, p.audienceTz);
        return (
          <div className="flex flex-col">
            <span className="text-13 font-medium">{audience}</span>
            {showViewer ? (
              <span className="text-xs text-muted">
                Your time: {formatWhen(p.scheduledAt, viewerTz)}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'how',
      headClassName: 'w-[180px]',
      header: 'HOW',
      cell: (p) => (
        <div className="flex flex-col items-start gap-1">
          <StatusChip tone={howTone(p.how)}>{howLabel(p.how, p.platform)}</StatusChip>
          {p.how === 'not_connected' ? (
            <Link
              to="/integrations"
              className="focus-ring whitespace-nowrap rounded-sm text-xs font-medium text-joy-text underline underline-offset-2"
              onClick={(e) => e.stopPropagation()}
            >
              Connect in Integrations
            </Link>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'STATUS',
      cell: (p) => (
        <div className="flex max-w-[220px] flex-col items-start gap-1">
          <PostStatusChip status={p.status} />
          {p.status === 'failed' && p.error ? (
            <span className="line-clamp-2 text-xs text-danger-text" role="note" title={p.error}>
              {p.error}
            </span>
          ) : null}
          {p.status === 'published' && p.liveUrl ? (
            <a
              href={p.liveUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-xs font-medium text-care-text underline underline-offset-2"
            >
              Open post <Icon icon={ArrowSquareOut} size={12} />
            </a>
          ) : null}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (p) => {
        const actions = rowActions(p, gateAllowed);
        if (actions.length === 0) return null;
        const name = channelLabel(p.platform, briefKind, p.channel.displayName);
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={DotsThreeVertical}
                  label={`Actions for ${name}`}
                  variant="ghost"
                  size="sm"
                  tooltip={false}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {actions.map((a) => (
                  <DropdownMenuItem key={a} onSelect={() => onAction(p, a)} className="gap-2">
                    <Icon icon={ACTION_META[a].icon} size={16} />
                    {ACTION_META[a].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      look="figma"
      stagger
      columns={columns}
      rows={posts}
      getRowId={(p) => p.id}
      caption="Channels for this piece: format, language, time in the audience zone and how it goes out"
      loading={loading}
      error={error}
      {...(onRetryLoad ? { onRetry: onRetryLoad } : {})}
      empty="No posts yet. Posts are made when both gates approve the piece."
      {...(onSelect
        ? { onRowClick: onSelect, isRowSelected: (p: PostView) => p.id === selectedId }
        : {})}
    />
  );
}
