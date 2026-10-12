/**
 * /studio with no brief: pick a brief that is ready to make.
 * No Figma frame: same panel, table and chips as the Review list and the Briefs list, so the
 * three lists read as one family (same stage chip colours, muted mode column).
 */
import { FilmSlate } from '@phosphor-icons/react';
import { Link, useNavigate } from 'react-router-dom';
import { BRIEF_STAGE_LABELS, type Brief } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { useBriefs } from '../api';
import { modeLabel, STAGE_TONES } from '../brief/labels';

const columns: DataTableColumn<Brief>[] = [
  {
    id: 'code',
    header: 'CODE',
    cell: (b) => <span className="font-semibold text-ink">{b.code}</span>,
    className: 'w-[120px]',
  },
  { id: 'title', header: 'PIECE', cell: (b) => <span className="text-ink">{b.title}</span> },
  {
    id: 'mode',
    header: 'MODE',
    cell: (b) => modeLabel(b.mode),
    className: 'whitespace-nowrap text-muted',
  },
  {
    id: 'stage',
    header: 'STAGE',
    cell: (b) => <StatusChip tone={STAGE_TONES[b.stage]}>{BRIEF_STAGE_LABELS[b.stage]}</StatusChip>,
  },
  { id: 'owner', header: 'OWNER', cell: (b) => b.owner?.name ?? 'Not set' },
];

export function StudioPicker() {
  const navigate = useNavigate();
  const { productId, product, isLoading: productLoading } = useSelectedProduct();
  const briefs = useBriefs({ productId, stage: ['frozen', 'made'], limit: 100 });

  return (
    <Page title="Studio" subtitle="Pick a brief to make">
      <Panel
        flush
        title="Ready to make"
        description={
          product ? `Frozen and made briefs for ${product.name}` : 'Frozen and made briefs'
        }
      >
        <DataTable
          caption="Briefs ready to make"
          columns={columns}
          rows={briefs.data?.items}
          getRowId={(b) => b.id}
          loading={productLoading || (Boolean(productId) && briefs.isPending)}
          error={briefs.error}
          onRetry={() => void briefs.refetch()}
          onRowClick={(b) => navigate(`/studio/${b.id}`)}
          empty={
            <EmptyState
              icon={FilmSlate}
              bordered={false}
              title="Nothing to make yet"
              description="Freeze a brief first. Frozen briefs show up here, ready for the Studio."
              action={
                <Button asChild variant="secondary" size="sm">
                  <Link to="/briefs">Open briefs</Link>
                </Button>
              }
            />
          }
        />
      </Panel>
    </Page>
  );
}
