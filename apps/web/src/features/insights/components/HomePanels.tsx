/**
 * Home cards (Figma 239:675): stat tiles, Needs you, Going out today, Next posts, Claude this
 * week, Sales pipeline, Products.
 */
import { CalendarBlank, ChatCircle, CheckCircle, SealCheck, Sparkle } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { PLATFORM_LABELS, type DashboardResponse, type NeedsYouKind } from '@growth-desk/contract';
import { Button } from '@/components/atoms/Button';
import { Icon, type IconComponent } from '@/components/atoms/Icon';
import { StatusChip } from '@/components/atoms/StatusChip';
import { EmptyState } from '@/components/molecules/EmptyState';
import { ListRow } from '@/components/molecules/ListRow';
import { ProductDot } from '@/components/molecules/ProductDot';
import { StatTile } from '@/components/molecules/StatTile';
import { Panel } from '@/components/organisms/Panel';
import { Skeleton } from '@/components/ui/skeleton';
import {
  compactNumber,
  dayTimeInZone,
  deltaText,
  PLATFORM_ICONS,
  timeInZone,
  waitingFor,
} from '../format';

type Dashboard = DashboardResponse;

/* ---------- Stat tiles ---------- */

export function HomeStats({ data, loading }: { data: Dashboard | undefined; loading: boolean }) {
  const s = data?.stats;
  const tone = (pct: number | null) =>
    pct !== null && pct < 0 ? 'danger' : pct === null ? 'muted' : 'joy';
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Reach · 7 days"
        loading={loading}
        value={s ? compactNumber(s.reach7d.value) : '-'}
        delta={s ? deltaText(s.reach7d.deltaPct) : undefined}
        deltaTone={tone(s?.reach7d.deltaPct ?? null)}
      />
      <StatTile
        label="Saves + shares"
        loading={loading}
        value={s ? compactNumber(s.savesShares7d.value) : '-'}
        delta={s ? deltaText(s.savesShares7d.deltaPct) : undefined}
        deltaTone={tone(s?.savesShares7d.deltaPct ?? null)}
      />
      <StatTile
        label="Installs (UTM)"
        loading={loading}
        value={s ? compactNumber(s.installs7d.value) : '-'}
        delta={s ? deltaText(s.installs7d.deltaPct) : undefined}
        deltaTone={tone(s?.installs7d.deltaPct ?? null)}
      />
      <StatTile
        label="Open partner leads"
        loading={loading}
        value={s ? s.openLeads.value.toLocaleString('en-US') : '-'}
        delta={s ? `${s.openLeads.newThisWeek} new this week` : undefined}
      />
    </div>
  );
}

/* ---------- Needs you ---------- */

const NEEDS_ICON: Record<NeedsYouKind, IconComponent> = {
  approval: SealCheck,
  plan_to_freeze: CalendarBlank,
  keyword_comments: ChatCircle,
};
const NEEDS_ACTION: Record<NeedsYouKind, { label: string; primary: boolean }> = {
  approval: { label: 'Review', primary: true },
  plan_to_freeze: { label: 'Open plan', primary: false },
  keyword_comments: { label: 'Open inbox', primary: false },
};

export function NeedsYouPanel({ items }: { items: Dashboard['needsYou'] }) {
  return (
    <Panel title="Needs you">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted">
          <Icon icon={CheckCircle} size={18} className="text-care" />
          Nothing is waiting on you. Nice.
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => {
            const action = NEEDS_ACTION[item.kind];
            return (
              <ListRow
                as="li"
                key={item.id}
                icon={NEEDS_ICON[item.kind]}
                title={item.title}
                meta={item.since ? `${item.meta} · ${waitingFor(item.since)}` : item.meta}
                action={
                  <Button asChild variant={action.primary ? 'primary' : 'secondary'}>
                    <Link to={item.link}>{action.label}</Link>
                  </Button>
                }
              />
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Going out today ---------- */

const KIND_LABEL: Record<string, string> = {
  reel: 'Reel',
  short: 'Short',
  poster: 'Poster',
  carousel: 'Carousel',
  post: 'Post',
};

function deliveryChip(p: Dashboard['goingOutToday'][number]) {
  if (p.status === 'published') return <StatusChip tone="success">Published</StatusChip>;
  if (p.status === 'failed') return <StatusChip tone="danger">Failed · retry by hand</StatusChip>;
  if (p.status === 'publishing') return <StatusChip tone="care">Publishing</StatusChip>;
  if (p.delivery === 'manual')
    return <StatusChip tone="reminder">Reminder · post by hand</StatusChip>;
  if (p.delivery === 'needs_approval')
    return <StatusChip tone="neutral">Needs API approval</StatusChip>;
  return <StatusChip tone="scheduled">Scheduled · auto</StatusChip>;
}

export function GoingOutTodayPanel({ posts }: { posts: Dashboard['goingOutToday'] }) {
  return (
    <Panel
      title="Going out today"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/publish">Publish</Link>
        </Button>
      }
    >
      {posts.length === 0 ? (
        <p className="py-2 text-sm text-muted">Nothing is scheduled for today.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((p) => (
            <li key={p.postId}>
              <Link
                to={`/publish/${p.briefId}`}
                className="focus-ring -mx-2 flex items-center gap-3.5 rounded-md px-2 py-0.5 hover:bg-surface-sunken/60"
              >
                <span className="w-24 shrink-0 text-13 font-semibold text-muted">
                  {timeInZone(p.scheduledAt, p.audienceTz)}
                </span>
                <Icon
                  icon={PLATFORM_ICONS[p.platform]}
                  size={20}
                  label={PLATFORM_LABELS[p.platform]}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {KIND_LABEL[p.briefKind] ?? 'Post'} · {p.title}
                </span>
                {deliveryChip(p)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Next posts per channel ---------- */

export function NextPostsPanel({ items }: { items: Dashboard['nextPosts'] }) {
  return (
    <Panel title="Next posts" description="The next post on each channel for this product">
      {items.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          No posts booked and no posting slots set. Add slots in{' '}
          <Link className="font-semibold text-ink underline" to="/settings?tab=schedule">
            Settings
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.platform} className="flex items-center gap-3.5">
              <Icon
                icon={PLATFORM_ICONS[n.platform]}
                size={20}
                label={PLATFORM_LABELS[n.platform]}
              />
              <span className="w-36 shrink-0 text-13 font-semibold text-muted">
                {dayTimeInZone(n.at, n.audienceTz)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {n.source === 'post' ? `${n.briefCode} · ${n.title}` : 'Free slot'}
              </span>
              {n.source === 'post' ? (
                <StatusChip tone="scheduled">Booked</StatusChip>
              ) : (
                <StatusChip tone="neutral">Open slot</StatusChip>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Claude this week ---------- */

export function ClaudeThisWeekPanel({
  claude,
  onOpenNote,
}: {
  claude: Dashboard['claudeThisWeek'];
  onOpenNote: () => void;
}) {
  return (
    <Panel
      tone="dark"
      title="Claude this week"
      titleIcon={<Icon icon={Sparkle} size={20} className="text-joy" />}
    >
      <p className="text-sm text-media-text">
        {claude.note?.body ??
          'No Monday note yet. It is written every Monday from last week’s numbers.'}
      </p>
      {claude.newIdeasThisWeek > 0 ? (
        <p className="text-xs text-media-text/70">
          {claude.newIdeasThisWeek} new {claude.newIdeasThisWeek === 1 ? 'idea' : 'ideas'} from
          Claude this week
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link to="/ideas">Open ideas →</Link>
        </Button>
        {claude.note ? (
          <Button
            variant="ghost"
            className="text-media-text hover:bg-white/10"
            onClick={onOpenNote}
          >
            Read the note
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/* ---------- Sales pipeline ---------- */

const PIPELINE_TILES = [
  ['new', 'New'],
  ['talking', 'Talking'],
  ['pilot', 'Pilot'],
  ['won', 'Won'],
] as const;

export function PipelinePanel({ pipeline }: { pipeline: Dashboard['pipeline'] }) {
  return (
    <Panel
      title="Sales pipeline"
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link to="/sales">Open</Link>
        </Button>
      }
    >
      <ul className="grid grid-cols-4 gap-2">
        {PIPELINE_TILES.map(([key, label]) => (
          <li key={key}>
            <Link
              to="/sales"
              aria-label={`${pipeline[key]} ${label}`}
              className="focus-ring flex flex-col rounded-tile bg-surface-sunken p-3 hover:bg-surface-sunken/70"
            >
              <span className="text-xl font-bold text-ink">{pipeline[key]}</span>
              <span className="text-xs text-muted">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ---------- Products ---------- */

export function ProductsPanel({ products }: { products: Dashboard['products'] }) {
  return (
    <Panel title="Products">
      {products.length === 0 ? (
        <p className="text-sm text-muted">No products yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {products.map((p) => (
            <li key={p.id}>
              <Link
                to={`/products/${p.id}/kit`}
                className="focus-ring -mx-1 inline-flex rounded-md px-1"
              >
                <ProductDot
                  color={p.color}
                  name={p.name}
                  meta={
                    !p.kitSigned && p.piecesThisWeek === 0
                      ? 'Kit in progress'
                      : `${p.piecesThisWeek} ${p.piecesThisWeek === 1 ? 'piece' : 'pieces'} this week`
                  }
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---------- Loading ---------- */

export function HomeSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_392px]" aria-busy="true">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-48 rounded-card" />
      </div>
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    </div>
  );
}

export function NoProductState() {
  return (
    <EmptyState
      title="No product yet"
      description="Add the first product to see its day at a glance."
      action={
        <Button asChild>
          <Link to="/products">Open products</Link>
        </Button>
      }
    />
  );
}
