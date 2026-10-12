// Analytics (Figma frame 242:1302). Owned by the INSIGHTS agent.
import * as React from 'react';
import { toast } from 'sonner';
import {
  ANALYTICS_RANGES,
  CONTENT_MODE_LONG_LABELS,
  PLATFORM_LABELS,
  type AnalyticsRange,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { StatTile } from '@/components/molecules/StatTile';
import { Stagger, StaggerItem } from '@/components/motion';
import { Page } from '@/components/templates/Page';
import { api } from '@/lib/api';
import { useSelectedProduct } from '@/lib/use-selected-product';
import {
  useAnalyticsByChannel,
  useAnalyticsByMode,
  useAnalyticsPosts,
  useAnalyticsSummary,
} from '@/features/insights/api';
import {
  InstallsByChannelPanel,
  PostsPanel,
  ReachByWeekPanel,
  ValueByModePanel,
} from '@/features/insights/components/AnalyticsPanels';
import { MondayNoteDialog } from '@/features/insights/components/MondayNoteDialog';
import { Segmented } from '@/features/insights/components/Segmented';
import { compactNumber, deltaText, toCsv } from '@/features/insights/format';
import type { AnalyticsPostsResponse } from '@growth-desk/contract';

const PAGE_SIZE = 20;
type Scope = 'product' | 'all';

export default function AnalyticsPage() {
  const selected = useSelectedProduct();
  const [days, setDays] = React.useState<AnalyticsRange>(28);
  const [scope, setScope] = React.useState<Scope>('product');
  // The page resets when the window or product changes (kept with the key it belongs to).
  const [paging, setPaging] = React.useState({ key: '', page: 0 });
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const productId = scope === 'product' ? selected.productId : null;

  const pageKey = `${days}:${productId ?? 'all'}`;
  const page = paging.key === pageKey ? paging.page : 0;
  const setPage = (p: number) => setPaging({ key: pageKey, page: p });

  const summary = useAnalyticsSummary(productId, days);
  const byChannel = useAnalyticsByChannel(productId, days);
  const byMode = useAnalyticsByMode(productId, days);
  const posts = useAnalyticsPosts(productId, days, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const s = summary.data;
  const loading = !s;
  const tone = (pct: number | null) =>
    pct !== null && pct < 0 ? 'danger' : pct === null ? 'muted' : 'joy';
  const subtitle = [
    'Every number ends in the activation event',
    scope === 'product' ? selected.product?.name : 'All products',
    s?.isSample ? 'sample data' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  async function exportCsv() {
    setExporting(true);
    try {
      const all: AnalyticsPostsResponse['items'] = [];
      for (let offset = 0; ; offset += 100) {
        const res = await api<AnalyticsPostsResponse>('/analytics/posts', {
          query: { productId, days, limit: 100, offset, sort: 'value' },
        });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
      }
      const csv = toCsv([
        [
          'Brief',
          'Title',
          'Mode',
          'Channel',
          'Published',
          'Reach',
          'Saves',
          'Shares',
          'Comments',
          'Clicks',
          'Installs',
          'Activations',
          'Value per 1K reach',
        ],
        ...all.map((p) => [
          p.briefCode,
          p.title,
          `${p.mode} ${CONTENT_MODE_LONG_LABELS[p.mode]}`,
          PLATFORM_LABELS[p.platform],
          p.publishedAt,
          p.reach,
          p.saves,
          p.shares,
          p.comments,
          p.clicks,
          p.installs,
          p.activations,
          p.valueScore,
        ]),
      ]);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `growth-desk-analytics-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} ${all.length === 1 ? 'post' : 'posts'}`);
    } catch {
      toast.error('Export failed', { description: 'Please try again.' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page
      title={`Analytics · last ${days} days`}
      subtitle={subtitle}
      // Figma Analytics: 20px between the content blocks.
      className="gap-5"
      actions={
        <>
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
            Export
          </Button>
          <Button onClick={() => setNoteOpen(true)}>Monday note</Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Time window"
          value={String(days) as `${AnalyticsRange}`}
          options={ANALYTICS_RANGES.map((d) => ({
            value: String(d) as `${AnalyticsRange}`,
            label: `${d} days`,
          }))}
          onChange={(v) => setDays(Number(v) as AnalyticsRange)}
        />
        <Segmented
          label="Products"
          value={scope}
          options={[
            { value: 'product', label: selected.product?.shortName ?? 'This product' },
            { value: 'all', label: 'All products' },
          ]}
          onChange={setScope}
        />
      </div>

      <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,240px))]">
        <StaggerItem>
          <StatTile
            label="Reach"
            loading={loading}
            value={s ? compactNumber(s.totals.reach) : '-'}
            delta={s ? deltaText(s.deltas.reach, '') : undefined}
            deltaTone={tone(s?.deltas.reach ?? null)}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Saves + shares"
            loading={loading}
            value={s ? compactNumber(s.totals.saves + s.totals.shares) : '-'}
            delta={s ? deltaText(s.deltas.savesShares, '') : undefined}
            deltaTone={tone(s?.deltas.savesShares ?? null)}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Installs (UTM)"
            loading={loading}
            value={s ? compactNumber(s.totals.installs) : '-'}
            delta={s ? deltaText(s.deltas.installs, '') : undefined}
            deltaTone={tone(s?.deltas.installs ?? null)}
          />
        </StaggerItem>
        <StaggerItem>
          <StatTile
            label="Activated"
            loading={loading}
            value={s ? compactNumber(s.totals.activations) : '-'}
            delta={
              s
                ? s.activationRatePct === null
                  ? 'No installs yet'
                  : `${s.activationRatePct}% of installs`
                : undefined
            }
          />
        </StaggerItem>
      </Stagger>

      <Stagger className="flex flex-col gap-5">
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <StaggerItem>
            <InstallsByChannelPanel q={byChannel} />
          </StaggerItem>
          <StaggerItem>
            <ReachByWeekPanel q={summary} />
          </StaggerItem>
        </div>
        <StaggerItem>
          <ValueByModePanel q={byMode} />
        </StaggerItem>
        <StaggerItem>
          <PostsPanel q={posts} page={page} pageSize={PAGE_SIZE} onPage={setPage} />
        </StaggerItem>
      </Stagger>

      <MondayNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        productId={selected.productId}
        productName={selected.product?.name}
      />
    </Page>
  );
}
