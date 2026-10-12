// Review list (Figma frame 241:1193 shows one piece; the list uses the same house style).
// Owned by the GATES agent.
import { Eye } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import type { ReviewQueueItem } from '@growth-desk/contract';
import { StatusChip } from '@/components/atoms';
import { EmptyState, ErrorState, ProductDot } from '@/components/molecules';
import { DataTable, Panel, type DataTableColumn } from '@/components/organisms';
import { Page } from '@/components/templates/Page';
import { useReviewQueue } from '@/features/gates/api';
import { formatWaiting } from '@/features/gates/format';
import { useSelectedProduct } from '@/lib/use-selected-product';

const columns: DataTableColumn<ReviewQueueItem>[] = [
  {
    id: 'piece',
    header: 'PIECE',
    cell: (r) => (
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-ink">
          {r.brief.code} · {r.brief.title}
        </span>
        <ProductDot color={r.brief.productColor} meta={r.brief.productShortName} size={8} />
      </div>
    ),
  },
  {
    id: 'stage',
    header: 'STAGE',
    cell: (r) =>
      r.brief.stage === 'made' ? (
        <StatusChip tone="joy">In review</StatusChip>
      ) : (
        <StatusChip tone="care">Waiting for approval</StatusChip>
      ),
  },
  {
    id: 'checklist',
    header: 'CHECKLIST',
    cell: (r) => (
      <span className={r.checklistDone === r.checklistTotal ? 'text-care-text' : 'text-ink'}>
        {r.checklistDone} of {r.checklistTotal}
      </span>
    ),
  },
  {
    id: 'comments',
    header: 'OPEN COMMENTS',
    align: 'right',
    cell: (r) => r.openComments,
  },
  {
    id: 'since',
    header: 'UPDATED',
    align: 'right',
    cell: (r) => <span className="text-muted">{formatWaiting(r.brief.updatedAt)} ago</span>,
  },
];

export default function ReviewListPage() {
  const {
    productId,
    product,
    isLoading: productsLoading,
    isError: productsFailed,
    error: productsError,
    refetch,
  } = useSelectedProduct();
  const queue = useReviewQueue(productId);
  const navigate = useNavigate();

  return (
    <Page
      title="Review"
      subtitle={
        product ? `Pieces in review for ${product.name}` : 'Internal review by the product team'
      }
    >
      {productsFailed ? (
        <ErrorState error={productsError} onRetry={() => void refetch()} />
      ) : !productsLoading && !productId ? (
        <EmptyState
          title="No product yet"
          description="Add a product first. Review lists pieces per product."
        />
      ) : (
        <Panel
          title="Pieces to check"
          description="Open a piece to watch it, tick the checklist and comment."
        >
          <DataTable
            caption="Pieces in review"
            columns={columns}
            rows={queue.data?.items}
            getRowId={(r) => r.brief.id}
            loading={queue.isPending}
            error={queue.error}
            onRetry={() => void queue.refetch()}
            onRowClick={(r) => navigate(`/review/${r.brief.id}`)}
            empty={
              <EmptyState
                icon={Eye}
                bordered={false}
                title="Nothing to review"
                description="When a maker sends a piece for review from Studio, it shows here."
              />
            }
          />
        </Panel>
      )}
    </Page>
  );
}
