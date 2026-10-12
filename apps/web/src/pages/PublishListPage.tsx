// Publish queue: approved, scheduled and live pieces of the selected product. Figma frame 242:1131.
import { PaperPlaneTilt } from '@phosphor-icons/react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { BRIEF_STAGE_LABELS, type BriefStage, type PublishQueueItem } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { StatusChip, type StatusTone } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { QUEUE_PAGE_SIZE, usePublishQueue, type PublishQueueStage } from '@/features/publish/api';
import { formatShortDateTime } from '@/features/publish/format';
import { PlatformIcon } from '@/features/publish/PlatformIcon';

const FILTERS: { value: PublishQueueStage | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'live', label: 'Live' },
];

const STAGE_TONE: Partial<Record<BriefStage, StatusTone>> = {
  approved: 'joy',
  scheduled: 'scheduled',
  live: 'success',
};

const columns: DataTableColumn<PublishQueueItem>[] = [
  {
    id: 'code',
    header: 'CODE',
    cell: (r) => <span className="text-13 font-semibold">{r.code}</span>,
  },
  {
    id: 'title',
    header: 'TITLE',
    cell: (r) => <span className="text-sm font-semibold text-ink">{r.title}</span>,
  },
  {
    id: 'stage',
    header: 'STAGE',
    cell: (r) => (
      <StatusChip tone={STAGE_TONE[r.stage] ?? 'neutral'}>{BRIEF_STAGE_LABELS[r.stage]}</StatusChip>
    ),
  },
  {
    id: 'channels',
    header: 'CHANNELS',
    cell: (r) => (
      <span className="flex items-center gap-1.5">
        {r.channels.map((c) => (
          <PlatformIcon key={c} platform={c} size={18} labelled />
        ))}
      </span>
    ),
  },
  {
    id: 'counts',
    header: 'POSTS',
    cell: (r) => (
      <span className="flex flex-wrap gap-1.5">
        <StatusChip tone="scheduled">{r.counts.scheduled} scheduled</StatusChip>
        <StatusChip tone="success">{r.counts.published} published</StatusChip>
        {r.counts.failed > 0 ? (
          <StatusChip tone="danger">{r.counts.failed} failed</StatusChip>
        ) : null}
        {r.counts.manual_pending > 0 ? (
          <StatusChip tone="reminder">{r.counts.manual_pending} by hand</StatusChip>
        ) : null}
      </span>
    ),
  },
  {
    id: 'next',
    header: 'NEXT',
    cell: (r) =>
      r.nextScheduledAt ? (
        <span className="text-13 font-medium">{formatShortDateTime(r.nextScheduledAt)}</span>
      ) : (
        <span className="text-13 text-muted">-</span>
      ),
  },
];

export default function PublishListPage() {
  const navigate = useNavigate();
  const { productId, product, isLoading: productLoading } = useSelectedProduct();
  const [stage, setStage] = React.useState<PublishQueueStage | undefined>(undefined);
  // Page offset belongs to one product and stage; a new filter starts at the first page.
  const pageKey = `${productId ?? ''}:${stage ?? 'all'}`;
  const [page, setPage] = React.useState({ key: pageKey, offset: 0 });
  const offset = page.key === pageKey ? page.offset : 0;
  const setOffset = (next: number) => setPage({ key: pageKey, offset: next });
  const queue = usePublishQueue(productId, stage, offset);

  const total = queue.data?.total ?? 0;
  const subtitle = product
    ? `${product.name} · right place, right time`
    : 'Right place, right time';

  return (
    <Page title="Publish" subtitle={subtitle}>
      {!productLoading && !productId ? (
        <EmptyState
          title="Pick a product"
          description="Choose a product in the sidebar to see what is ready to publish."
        />
      ) : (
        <Panel>
          <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = f.value === stage;
              return (
                <Button
                  key={f.label}
                  size="sm"
                  variant={active ? 'dark' : 'secondary'}
                  aria-pressed={active}
                  onClick={() => setStage(f.value)}
                >
                  {f.label}
                </Button>
              );
            })}
          </div>
          {queue.isError ? (
            <ErrorState
              error={queue.error}
              onRetry={() => void queue.refetch()}
              retrying={queue.isFetching}
            />
          ) : queue.data && queue.data.items.length === 0 ? (
            <EmptyState
              bordered={false}
              icon={PaperPlaneTilt}
              title="Nothing to publish yet"
              description="A piece shows here once both gates approve it."
            />
          ) : (
            <DataTable
              columns={columns}
              rows={queue.data?.items}
              getRowId={(r) => r.briefId}
              caption="Pieces ready to publish, scheduled or live"
              loading={queue.isPending}
              onRowClick={(r) => navigate(`/publish/${r.briefId}`)}
            />
          )}
          {total > QUEUE_PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 text-13 text-muted">
              <span>
                {offset + 1} to {Math.min(offset + QUEUE_PAGE_SIZE, total)} of {total}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - QUEUE_PAGE_SIZE))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={offset + QUEUE_PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + QUEUE_PAGE_SIZE)}
                >
                  Next
                </Button>
              </span>
            </div>
          ) : null}
        </Panel>
      )}
    </Page>
  );
}
