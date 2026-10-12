// Briefs list (route /briefs). No Figma frame exists for this list: placeholder design in the
// house style (Page, chips, DataTable), to be replaced when Jeeva draws the frame.
import { Plus } from '@phosphor-icons/react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { BRIEF_STAGE_LABELS, BRIEF_STAGES, type Brief, type BriefStage } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { SearchInput } from '@/components/atoms/SearchInput';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { cn } from '@/lib/utils';
import { useBriefs } from '@/features/make/api';
import { modeLabel, STAGE_TONES } from '@/features/make/brief/labels';
import { NewBriefDialog } from '@/features/make/brief/NewBriefDialog';

const updatedFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const columns: DataTableColumn<Brief>[] = [
  { id: 'code', header: 'Code', cell: (b) => <span className="font-semibold">{b.code}</span>, className: 'whitespace-nowrap' },
  { id: 'title', header: 'Title', cell: (b) => b.title, className: 'min-w-[200px]' },
  { id: 'mode', header: 'Mode', cell: (b) => modeLabel(b.mode), className: 'whitespace-nowrap text-muted' },
  {
    id: 'stage',
    header: 'Stage',
    cell: (b) => <StatusChip tone={STAGE_TONES[b.stage]}>{BRIEF_STAGE_LABELS[b.stage]}</StatusChip>,
  },
  { id: 'owner', header: 'Owner', cell: (b) => b.owner?.name ?? <span className="text-muted">Not set</span> },
  {
    id: 'updated',
    header: 'Updated',
    align: 'right',
    cell: (b) => <time dateTime={b.updatedAt}>{updatedFormat.format(new Date(b.updatedAt))}</time>,
    className: 'whitespace-nowrap text-muted',
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function BriefsPage() {
  const navigate = useNavigate();
  const selected = useSelectedProduct();
  const [stage, setStage] = React.useState<BriefStage | 'all'>('all');
  const [search, setSearch] = React.useState('');
  const q = useDebounced(search.trim(), 300);
  const [creating, setCreating] = React.useState(false);

  const query = useBriefs({
    productId: selected.productId,
    ...(stage !== 'all' ? { stage: [stage] } : {}),
    ...(q ? { q } : {}),
  });

  const filtered = stage !== 'all' || q !== '';

  return (
    <Page
      title="Briefs"
      subtitle={selected.product ? `One piece, fully written down · ${selected.product.name}` : 'One piece, fully written down'}
      actions={
        <Button leftIcon={Plus} onClick={() => setCreating(true)} disabled={!selected.productId}>
          New brief
        </Button>
      }
    >
      {selected.isError ? (
        <ErrorState error={selected.error} onRetry={() => void selected.refetch()} />
      ) : !selected.isLoading && !selected.productId ? (
        <EmptyState title="No product yet" description="Add a product first. Briefs belong to a product." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Filter by stage" className="flex flex-wrap gap-1.5">
              {(['all', ...BRIEF_STAGES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={stage === s}
                  onClick={() => setStage(s)}
                  className={cn(
                    'focus-ring rounded-pill px-3 py-1 text-xs font-semibold transition-colors',
                    stage === s ? 'bg-media-canvas text-media-text' : 'bg-surface-card text-ink hover:bg-surface-sunken',
                  )}
                >
                  {s === 'all' ? 'All' : BRIEF_STAGE_LABELS[s]}
                </button>
              ))}
            </div>
            <SearchInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or title"
              containerClassName="ml-auto w-full sm:w-64"
            />
          </div>
          <Panel flush className="overflow-x-auto">
            <DataTable
              caption="Briefs for the selected product"
              columns={columns}
              rows={query.data?.items}
              getRowId={(b) => b.id}
              loading={query.isPending}
              error={query.error}
              onRetry={() => void query.refetch()}
              onRowClick={(b) => navigate(`/briefs/${b.id}`)}
              empty={filtered ? 'No briefs match this filter.' : 'No briefs yet. Open a starred idea as a brief, or start one by hand.'}
            />
          </Panel>
          {query.data && query.data.total > query.data.items.length ? (
            <p className="text-xs text-muted">
              Showing {query.data.items.length} of {query.data.total}. Narrow the filter to see more.
            </p>
          ) : null}
        </>
      )}
      {selected.productId ? <NewBriefDialog open={creating} onOpenChange={setCreating} productId={selected.productId} /> : null}
    </Page>
  );
}
