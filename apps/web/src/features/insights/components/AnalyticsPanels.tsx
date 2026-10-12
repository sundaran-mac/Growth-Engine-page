/**
 * Analytics cards (Figma 242:1302): installs by channel, reach by week, value by content mode,
 * and the per-post ladder table.
 */
import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  CONTENT_MODE_LONG_LABELS,
  PLATFORM_LABELS,
  type AnalyticsByChannel,
  type AnalyticsByMode,
  type AnalyticsPostsResponse,
  type AnalyticsSummary,
  type PostInsight,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { ErrorState } from '@/components/molecules/ErrorState';
import { DataTable, type DataTableColumn } from '@/components/organisms/DataTable';
import { Panel } from '@/components/organisms/Panel';
import { DURATION, EASE } from '@/components/motion';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PLATFORM_ICONS } from '../format';

/** Bar colours in rank order, as in the Figma frame. */
const BAR_TONES = ['bg-joy', 'bg-care', 'bg-joy-soft', 'bg-care-soft', 'bg-surface-sunken'];

interface QueryState<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function PanelBody<T>({
  q,
  children,
  skeleton,
}: {
  q: QueryState<T>;
  children: (d: T) => React.ReactNode;
  skeleton: React.ReactNode;
}) {
  if (q.isError)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-6" />;
  if (!q.data) return <>{skeleton}</>;
  return <>{children(q.data)}</>;
}

const rowsSkeleton = (n: number) => (
  <div className="flex flex-col gap-3" aria-busy="true">
    {Array.from({ length: n }, (_, i) => (
      <Skeleton key={i} className="h-[22px] w-full" />
    ))}
  </div>
);

export function InstallsByChannelPanel({ q }: { q: QueryState<AnalyticsByChannel> }) {
  return (
    <Panel title={<span className="text-base">Installs by channel</span>}>
      <PanelBody q={q} skeleton={rowsSkeleton(5)}>
        {(d) => {
          const max = Math.max(1, ...d.items.map((i) => i.installs));
          if (d.items.length === 0)
            return <p className="text-sm text-muted">No numbers in this window yet.</p>;
          return (
            <ul className="flex flex-col gap-3">
              {d.items.map((item, i) => (
                <li key={item.platform} className="flex items-center gap-2.5">
                  <span className="w-[90px] shrink-0 text-13 text-ink">
                    {PLATFORM_LABELS[item.platform]}
                  </span>
                  {/* Figma: the number sits 10px after the end of its bar. */}
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <motion.span
                      className={cn(
                        'block h-[22px] shrink-0 rounded-sm',
                        BAR_TONES[i] ?? 'bg-surface-sunken',
                      )}
                      style={{
                        width: `calc((100% - 3rem) * ${Math.max(0.02, item.installs / max)})`,
                        transformOrigin: 'left',
                      }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: DURATION.slow, ease: EASE, delay: i * 0.04 }}
                      role="presentation"
                    />
                    <span className="shrink-0 text-13 font-semibold text-ink">{item.installs}</span>
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </PanelBody>
    </Panel>
  );
}

interface ChartRow {
  week: string;
  reach: number;
  weekStart: string;
}

export function ReachByWeekPanel({
  q,
  foundersNote,
}: {
  q: QueryState<AnalyticsSummary>;
  foundersNote?: string;
}) {
  // Draw the line once. A refetch keeps the same array (query structural sharing), so the memo
  // keeps the same chart rows and Recharts does not redraw the line.
  const animate = !useReducedMotion();
  const weeksRef = q.data?.reachByWeek;
  const chartData = React.useMemo<ChartRow[]>(
    () =>
      (weeksRef ?? []).map((w) => ({
        week: `W${w.isoWeek}`,
        reach: w.reach,
        weekStart: w.weekStart,
      })),
    [weeksRef],
  );
  return (
    <Panel title={<span className="text-base">Reach by week</span>}>
      <PanelBody q={q} skeleton={<Skeleton className="h-[170px] w-full" />}>
        {(d) => {
          const weeks = d.reachByWeek;
          const first = weeks[0]?.isoWeek;
          const last = weeks[weeks.length - 1]?.isoWeek;
          return (
            <>
              <figure
                className="h-[170px] w-full"
                aria-label={`Reach by week, weeks ${first} to ${last}`}
              >
                <ResponsiveContainer width="100%" height="100%">
                  {/* Figma: a bare line with dots, no axes or grid. Hover shows the numbers. */}
                  <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                    <XAxis dataKey="week" hide />
                    <YAxis hide domain={['dataMin', 'dataMax']} />
                    <Tooltip
                      formatter={(v) => [Number(v).toLocaleString('en-US'), 'Reach']}
                      labelFormatter={(label) => `Week ${String(label).slice(1)}`}
                    />
                    <Line
                      type="linear"
                      dataKey="reach"
                      stroke="rgb(var(--heart-joy))"
                      strokeWidth={2.5}
                      dot={{ r: 3.5, fill: 'rgb(var(--heart-joy))', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: 'rgb(var(--heart-joy))', strokeWidth: 0 }}
                      isAnimationActive={animate}
                      animationDuration={320}
                      animationEasing="ease-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </figure>
              <p className="text-xs text-muted">
                Weeks {first}-{last}
                {foundersNote ? ` · ${foundersNote}` : ''}
              </p>
            </>
          );
        }}
      </PanelBody>
    </Panel>
  );
}

export function ValueByModePanel({ q }: { q: QueryState<AnalyticsByMode> }) {
  return (
    <Panel title={<span className="text-base">What creates value · by content mode</span>}>
      <PanelBody q={q} skeleton={rowsSkeleton(4)}>
        {(d) =>
          d.items.length === 0 ? (
            <p className="text-sm text-muted">No numbers in this window yet.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* Figma: fixed columns 260/140/200/160/rest, rows 12px apart. */}
              <table
                className="-my-3 w-full min-w-[760px] table-fixed border-separate border-spacing-y-3 text-left"
                aria-label="Value per 1,000 reach by content mode, best first"
              >
                <colgroup>
                  <col className="w-[260px]" />
                  <col className="w-[140px]" />
                  <col className="w-[200px]" />
                  <col className="w-[160px]" />
                  <col />
                </colgroup>
                <thead>
                  <tr className="text-2xs font-semibold uppercase tracking-[0.08em] text-muted">
                    {['Mode', 'Pieces', 'Value / 1K reach', 'Installs', 'Best channel'].map(
                      (h, i, all) => (
                        <th
                          key={h}
                          scope="col"
                          className={cn(
                            'bg-surface-sunken px-3.5 py-2 font-semibold',
                            i === 0 && 'rounded-l-[10px]',
                            i === all.length - 1 && 'rounded-r-[10px]',
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="text-13 text-ink">
                  {d.items.map((m, i) => {
                    const cell = cn('px-3.5 py-2', i === 0 && 'bg-joy-soft');
                    return (
                      <tr key={m.mode}>
                        <th scope="row" className={cn(cell, 'rounded-l-md font-semibold')}>
                          {m.mode} {CONTENT_MODE_LONG_LABELS[m.mode]}
                        </th>
                        <td className={cell}>{m.pieces}</td>
                        <td className={cn(cell, 'font-bold')}>{Math.round(m.valuePer1k)}</td>
                        <td className={cell}>{m.installs}</td>
                        <td className={cn(cell, 'rounded-r-md')}>
                          {m.bestChannel ? PLATFORM_LABELS[m.bestChannel] : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </PanelBody>
    </Panel>
  );
}

const num = (n: number) => n.toLocaleString('en-US');

const postColumns: DataTableColumn<PostInsight>[] = [
  {
    id: 'piece',
    header: 'Piece',
    cell: (p) => (
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold text-ink">{p.briefCode}</span>
        <span className="truncate text-xs text-muted">{p.title}</span>
      </span>
    ),
  },
  {
    id: 'channel',
    header: 'Channel',
    cell: (p) => (
      <span className="inline-flex items-center gap-1.5">
        <Icon icon={PLATFORM_ICONS[p.platform]} size={16} />
        {PLATFORM_LABELS[p.platform]}
      </span>
    ),
  },
  { id: 'reach', header: 'Reach', align: 'right', cell: (p) => num(p.reach) },
  { id: 'saves', header: 'Saves', align: 'right', cell: (p) => num(p.saves) },
  { id: 'shares', header: 'Shares', align: 'right', cell: (p) => num(p.shares) },
  { id: 'clicks', header: 'Clicks', align: 'right', cell: (p) => num(p.clicks) },
  { id: 'installs', header: 'Installs', align: 'right', cell: (p) => num(p.installs) },
  { id: 'activations', header: 'Activated', align: 'right', cell: (p) => num(p.activations) },
  {
    id: 'value',
    header: 'Value / 1K',
    align: 'right',
    cell: (p) => <span className="font-bold">{Math.round(p.valueScore)}</span>,
  },
];

export function PostsPanel({
  q,
  page,
  pageSize,
  onPage,
}: {
  q: QueryState<AnalyticsPostsResponse> & { isFetching?: boolean };
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <Panel
      title={<span className="text-base">Every post · the ladder</span>}
      description="Reach, then saves and shares, clicks, installs and activations. Best value first."
      flush
      className="pb-2"
    >
      <div>
        <DataTable
          caption="Numbers per post in the selected window"
          columns={postColumns}
          rows={q.data?.items}
          getRowId={(p) => p.postId}
          loading={q.isPending}
          error={q.isError ? q.error : undefined}
          onRetry={() => void q.refetch()}
          empty="No published posts with numbers in this window."
        />
      </div>
      {total > pageSize ? (
        <div className="flex items-center justify-end gap-2 px-6 pb-5 text-13 text-muted">
          <span>
            Page {page + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={page + 1 >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
