/**
 * Schedule calendar: what goes out when, per channel, for the selected product.
 * Week and month views (Monday first), times in the viewer's zone with the audience zone
 * beside them, open posting slots shown as dashed chips.
 *
 * PLACEHOLDER DESIGN: there is no Figma frame for Schedule yet. Built in the style of the Plan
 * frame (240:1053) until Jeeva designs it.
 */
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { addMonths, addWeeks, format, isSameDay, isSameMonth } from 'date-fns';
import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PLATFORMS,
  type NextSlot,
  type Platform,
  type PostStatus,
  type ScheduleItem,
} from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { IconButton } from '@/components/atoms/IconButton';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ErrorState } from '@/components/molecules/ErrorState';
import { Panel } from '@/components/organisms/Panel';
import { Page } from '@/components/templates/Page';
import { useSelectedProduct } from '@/lib/use-selected-product';
import { cn } from '@/lib/utils';
import { useSchedule } from '../api';
import { formatTime, PLATFORM_ICONS, platformLabel, viewerTimeZone, zoneAbbr } from '../format';
import { parseAnchor, visibleRange, type ScheduleView } from '../calendar';
import { TabSkeleton } from './shared';

const STATUS_STYLE: Record<PostStatus, { chip: string; label: string }> = {
  draft: { chip: 'bg-surface-sunken text-ink', label: 'Draft' },
  scheduled: { chip: 'bg-joy-soft text-joy-text', label: 'Scheduled' },
  publishing: { chip: 'bg-joy text-ink', label: 'Publishing' },
  published: { chip: 'bg-care-soft text-care-text', label: 'Published' },
  failed: { chip: 'bg-danger-soft text-danger-text', label: 'Failed' },
  manual_pending: { chip: 'bg-media-canvas text-media-text', label: 'Post by hand' },
};

export function ScheduleScreen() {
  const { product, productId, isLoading, isError, error, refetch } = useSelectedProduct();
  const [params, setParams] = useSearchParams();
  const view: ScheduleView = params.get('view') === 'week' ? 'week' : 'month';
  const dateParam = params.get('date');
  const anchor = React.useMemo(() => parseAnchor(dateParam), [dateParam]);
  const range = React.useMemo(() => visibleRange(view, anchor), [view, anchor]);
  const query = useSchedule(productId, range.start.toISOString(), range.end.toISOString());
  const viewer = viewerTimeZone();

  const go = (next: { view?: ScheduleView; date?: Date }) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next.view) out.set('view', next.view);
        if (next.date) out.set('date', format(next.date, 'yyyy-MM-dd'));
        return out;
      },
      { replace: true },
    );
  const step = (dir: 1 | -1) =>
    go({ date: view === 'week' ? addWeeks(anchor, dir) : addMonths(anchor, dir) });

  const title =
    view === 'week'
      ? `Week of ${format(range.start, 'd MMM yyyy')}`
      : `${format(anchor, 'MMMM yyyy')}`;

  const byDay = React.useMemo(() => {
    const map = new Map<string, { posts: ScheduleItem[]; slots: NextSlot[] }>();
    for (const d of range.days) map.set(format(d, 'yyyy-MM-dd'), { posts: [], slots: [] });
    for (const item of query.data?.items ?? [])
      map.get(format(new Date(item.at), 'yyyy-MM-dd'))?.posts.push(item);
    for (const slot of query.data?.freeSlots ?? [])
      map.get(format(new Date(slot.at), 'yyyy-MM-dd'))?.slots.push(slot);
    return map;
  }, [query.data, range.days]);

  const counts = React.useMemo(() => {
    const c = new Map<Platform, { scheduled: number; published: number; open: number }>();
    for (const p of PLATFORMS) c.set(p, { scheduled: 0, published: 0, open: 0 });
    for (const i of query.data?.items ?? []) {
      const row = c.get(i.platform)!;
      if (i.status === 'published') row.published += 1;
      else row.scheduled += 1;
    }
    for (const s of query.data?.freeSlots ?? []) c.get(s.platform)!.open += 1;
    return [...c.entries()].filter(([, v]) => v.scheduled + v.published + v.open > 0);
  }, [query.data]);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded-pill bg-surface-sunken p-1"
        role="group"
        aria-label="Calendar view"
      >
        {(['week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => go({ view: v })}
            className={cn(
              'focus-ring rounded-pill px-4 py-1.5 text-13 font-semibold transition-colors',
              view === v ? 'bg-surface-card text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {v === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>
      <IconButton
        icon={CaretLeft}
        label={view === 'week' ? 'Previous week' : 'Previous month'}
        onClick={() => step(-1)}
      />
      <Button variant="secondary" size="sm" onClick={() => go({ date: new Date() })}>
        Today
      </Button>
      <IconButton
        icon={CaretRight}
        label={view === 'week' ? 'Next week' : 'Next month'}
        onClick={() => step(1)}
      />
    </div>
  );

  let body: React.ReactNode;
  if (isLoading) body = <TabSkeleton />;
  else if (isError) body = <ErrorState error={error} onRetry={() => void refetch()} />;
  else if (!productId)
    body = (
      <EmptyState icon={CalendarBlank} title="No products yet" description="Add a product first." />
    );
  else if (query.isPending) body = <TabSkeleton />;
  else if (query.isError)
    body = (
      <ErrorState
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  else {
    body = (
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section
          aria-label={`${title} calendar`}
          className="min-w-0 overflow-x-auto rounded-card border border-hairline bg-surface-card p-4"
          aria-busy={query.isFetching || undefined}
        >
          <div className="grid min-w-[700px] grid-cols-7 gap-1.5">
            {range.days.slice(0, 7).map((d) => (
              <div
                key={`h-${d.toISOString()}`}
                className="px-2 pb-1 text-xs font-semibold text-muted"
              >
                {format(d, 'EEE')}
              </div>
            ))}
            {range.days.map((d) => {
              const key = format(d, 'yyyy-MM-dd');
              const cell = byDay.get(key) ?? { posts: [], slots: [] };
              const outside = view === 'month' && !isSameMonth(d, anchor);
              const today = isSameDay(d, new Date());
              const limit = view === 'month' ? 3 : 50;
              const entries = [
                ...cell.posts.map((p) => ({ kind: 'post' as const, at: p.at, post: p })),
                ...cell.slots.map((s) => ({ kind: 'slot' as const, at: s.at, slot: s })),
              ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
              const shown = entries.slice(0, limit);
              return (
                <div
                  key={key}
                  className={cn(
                    'flex flex-col gap-1 rounded-tile border border-hairline p-1.5',
                    view === 'month' ? 'min-h-[104px]' : 'min-h-[320px]',
                    outside && 'bg-surface-base',
                  )}
                  aria-label={`${format(d, 'EEEE d MMMM')}: ${cell.posts.length} posts, ${cell.slots.length} open slots`}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                      today ? 'bg-joy text-ink' : outside ? 'text-muted' : 'text-ink',
                    )}
                  >
                    {format(d, 'd')}
                  </span>
                  {shown.map((e) =>
                    e.kind === 'post' ? (
                      <PostChip
                        key={e.post.postId}
                        item={e.post}
                        viewer={viewer}
                        detailed={view === 'week'}
                      />
                    ) : (
                      <SlotChip
                        key={`${e.slot.slotId}-${e.slot.at}`}
                        slot={e.slot}
                        viewer={viewer}
                      />
                    ),
                  )}
                  {entries.length > shown.length ? (
                    <button
                      type="button"
                      className="focus-ring rounded-md px-1 text-left text-2xs font-semibold text-muted hover:text-ink"
                      onClick={() => go({ view: 'week', date: d })}
                    >
                      {entries.length - shown.length} more
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
        <aside className="flex flex-col gap-4">
          <Panel
            title="By channel"
            description={`Times in your zone (${viewer.replace(/_/g, ' ')}).`}
          >
            {counts.length === 0 ? (
              <p className="text-sm text-muted">
                Nothing scheduled in this range, and no open slots.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {counts.map(([p, c]) => (
                  <li key={p} className="flex items-center gap-2.5 text-13">
                    <Icon icon={PLATFORM_ICONS[p]} size={18} />
                    <span className="flex-1 font-semibold text-ink">{platformLabel(p)}</span>
                    <span className="text-muted">
                      {c.scheduled} going out · {c.published} live · {c.open} open
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel tone="sunken" title="Key">
            <ul className="flex flex-col gap-2 text-xs">
              {(['scheduled', 'published', 'manual_pending', 'failed'] as const).map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <span
                    className={cn('inline-block h-3 w-6 rounded-pill', STATUS_STYLE[s].chip)}
                    aria-hidden="true"
                  />
                  {STATUS_STYLE[s].label}
                </li>
              ))}
              <li className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-6 rounded-pill border border-dashed border-strong"
                  aria-hidden="true"
                />
                Open posting slot
              </li>
            </ul>
            {query.data.launchDate ? (
              <p className="text-xs text-muted">First post day: {query.data.launchDate}.</p>
            ) : null}
            <Link
              to="/settings?tab=schedule"
              className="text-xs font-semibold text-ink underline underline-offset-2"
            >
              Change posting slots
            </Link>
          </Panel>
        </aside>
      </div>
    );
  }

  return (
    <Page
      title={product ? `Schedule · ${product.name}` : 'Schedule'}
      documentTitle="Schedule"
      subtitle={`${title} · what goes out when, on every channel`}
      actions={actions}
    >
      {body}
    </Page>
  );
}

function PostChip({
  item,
  viewer,
  detailed,
}: {
  item: ScheduleItem;
  viewer: string;
  detailed: boolean;
}) {
  const style = STATUS_STYLE[item.status];
  const audience =
    item.audienceTimezone !== viewer
      ? `${formatTime(item.at, item.audienceTimezone)} ${zoneAbbr(item.at, item.audienceTimezone)}`
      : null;
  const label = `${platformLabel(item.platform)} ${item.briefCode} ${style.label} at ${formatTime(item.at, viewer)}${audience ? `, audience ${audience}` : ''}`;
  return (
    <Link
      to={`/publish/${item.briefId}`}
      aria-label={label}
      title={`${item.briefTitle} · ${item.channelName}${audience ? ` · audience ${audience}` : ''}`}
      className={cn(
        'focus-ring flex flex-col gap-0.5 rounded-md px-1.5 py-1 text-2xs font-semibold',
        style.chip,
      )}
    >
      <span className="flex items-center gap-1">
        <Icon icon={PLATFORM_ICONS[item.platform]} size={12} />
        <span>{formatTime(item.at, viewer)}</span>
        <span className="truncate">{item.briefCode}</span>
      </span>
      {detailed ? (
        <>
          <span className="line-clamp-2 font-medium">{item.briefTitle}</span>
          {audience ? <span className="font-medium opacity-80">Audience {audience}</span> : null}
          <span className="font-medium opacity-80">{style.label}</span>
        </>
      ) : null}
    </Link>
  );
}

function SlotChip({ slot, viewer }: { slot: NextSlot; viewer: string }) {
  const audience =
    slot.audienceTimezone !== viewer
      ? ` · ${formatTime(slot.at, slot.audienceTimezone)} ${zoneAbbr(slot.at, slot.audienceTimezone)}`
      : '';
  return (
    <span
      className="flex items-center gap-1 rounded-md border border-dashed border-strong px-1.5 py-1 text-2xs font-medium text-muted"
      title={`Open ${platformLabel(slot.platform)} slot${slot.label ? `: ${slot.label}` : ''}`}
    >
      <Icon icon={PLATFORM_ICONS[slot.platform]} size={12} label={platformLabel(slot.platform)} />
      Open {formatTime(slot.at, viewer)}
      {audience}
    </span>
  );
}
