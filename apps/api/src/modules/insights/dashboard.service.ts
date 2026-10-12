/**
 * Home: the day at a glance. One call returns every card on the screen (GET /dashboard).
 */
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { Request } from 'express';
import {
  PLATFORM_LABELS,
  PLATFORMS,
  type DashboardProduct,
  type DashboardResponse,
  type LeadStage,
  type NeedsYouItem,
  type NextPost,
  type PipelineCounts,
  type Platform,
  type PostDelivery,
  type TodayPost,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  approvals,
  briefs,
  channelAccounts,
  ideas,
  leads,
  planItems,
  plans,
  postingSlots,
  posts,
  products,
} from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { toCount } from '../../lib/pagination.js';
import { dateKey, weekStartKey, zonedTimeToUtc } from '../../lib/time.js';
import { getMemberships } from '../auth/service.js';
import { nextFreeSlots } from '../settings/shared.js';
import { queuedKeywordGroups } from './keywords.service.js';
import { addDays, deltaPct, windows } from './logic.js';
import { sumTotals } from './metrics.repo.js';
import { latestNote } from './notes.service.js';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const LIVE_POST_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'manual_pending',
  'failed',
] as const;
const PIECE_POST_STATUSES = ['scheduled', 'publishing', 'published', 'manual_pending'] as const;

const startOfDay = (day: string, tz: string) => zonedTimeToUtc(day, '00:00', tz);

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function deliveryFor(platform: Platform, accountStatus: string): PostDelivery {
  if (platform === 'whatsapp' || accountStatus === 'manual') return 'manual';
  if (accountStatus === 'needs_approval') return 'needs_approval';
  return 'auto';
}

interface Viewer {
  id: string;
  role: string;
  memberships: { productId: string; productRole: string }[];
}

async function viewerOf(req: Request): Promise<Viewer> {
  const user = req.user!;
  return {
    id: user.id,
    role: user.role,
    memberships: req.memberships ?? (await getMemberships(user.id)),
  };
}

const isTeamWide = (v: Viewer) => v.role === 'admin' || v.role === 'editor';

/* ---------- Needs you ---------- */

async function approvalsForMe(v: Viewer, productId?: string): Promise<NeedsYouItem[]> {
  const where: SQL[] = [
    eq(approvals.decision, 'pending'),
    // Only the current brief version counts; older approvals are stale.
    eq(approvals.version, briefs.version),
    or(
      eq(approvals.approverId, v.id),
      and(eq(approvals.backupId, v.id), isNotNull(approvals.escalatedAt)),
    )!,
  ];
  if (productId) where.push(eq(briefs.productId, productId));
  const rows = await db
    .select({
      id: approvals.id,
      gate: approvals.gate,
      requestedAt: approvals.requestedAt,
      escalatedAt: approvals.escalatedAt,
      approverId: approvals.approverId,
      code: briefs.code,
      title: briefs.title,
      productShort: products.shortName,
    })
    .from(approvals)
    .innerJoin(briefs, eq(briefs.id, approvals.briefId))
    .innerJoin(products, eq(products.id, briefs.productId))
    .where(and(...where))
    .orderBy(asc(approvals.requestedAt));
  return rows.map((r) => ({
    id: `approval:${r.id}`,
    kind: 'approval',
    title: `Approve ${r.gate} · ${r.code} “${r.title}”`,
    meta: [
      r.productShort,
      r.gate === 'claims' ? 'owner approval' : 'brand approval',
      r.approverId !== v.id ? 'as backup' : null,
    ]
      .filter(Boolean)
      .join(' · '),
    link: '/approvals',
    since: r.requestedAt.toISOString(),
  }));
}

async function plansToFreeze(
  v: Viewer,
  month: string,
  productId?: string,
): Promise<NeedsYouItem[]> {
  const where: SQL[] = [eq(plans.status, 'draft'), inArray(plans.month, [month, nextMonth(month)])];
  if (productId) where.push(eq(plans.productId, productId));
  if (!isTeamWide(v)) {
    const owned = v.memberships.filter((m) => m.productRole === 'owner').map((m) => m.productId);
    if (owned.length === 0) return [];
    where.push(inArray(plans.productId, owned));
  }
  const rows = await db
    .select({
      id: plans.id,
      month: plans.month,
      createdAt: plans.createdAt,
      productShort: products.shortName,
      pieces: sql<string>`count(${planItems.id})`.mapWith(toCount),
      unbooked:
        sql<string>`count(${planItems.id}) filter (where ${planItems.needsShootSlot})`.mapWith(
          toCount,
        ),
    })
    .from(plans)
    .innerJoin(products, eq(products.id, plans.productId))
    .leftJoin(planItems, eq(planItems.planId, plans.id))
    .where(and(...where))
    .groupBy(plans.id, products.shortName)
    .orderBy(asc(plans.month));
  return rows.map((r) => {
    const name = MONTH_NAMES[Number(r.month.slice(5, 7)) - 1] ?? r.month;
    return {
      id: `plan:${r.id}`,
      kind: 'plan_to_freeze',
      title: `Freeze the ${name} plan`,
      meta: [
        r.productShort,
        `${r.pieces} ${r.pieces === 1 ? 'piece' : 'pieces'}`,
        r.unbooked > 0 ? `${r.unbooked} ${r.unbooked === 1 ? 'shoot' : 'shoots'} unbooked` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      link: `/plan?month=${r.month}`,
      since: null,
    };
  });
}

async function keywordComments(v: Viewer, productId?: string): Promise<NeedsYouItem[]> {
  let scope: string[] | null = productId ? [productId] : null;
  if (!isTeamWide(v)) {
    const mine = v.memberships.map((m) => m.productId);
    scope = scope ? scope.filter((id) => mine.includes(id)) : mine;
  }
  const groups = await queuedKeywordGroups(scope);
  return groups.map((g) => ({
    id: `keyword:${g.ruleId}`,
    kind: 'keyword_comments',
    title: `${g.count} ${g.count === 1 ? 'comment' : 'comments'} asked for the link`,
    meta: `${PLATFORM_LABELS[g.platform]} · keyword ${g.keyword} · replies queued`,
    link: '/sales?panel=keywords',
    since: g.since.toISOString(),
  }));
}

/* ---------- Posts ---------- */

async function goingOutToday(
  productId: string | undefined,
  today: string,
  tz: string,
): Promise<TodayPost[]> {
  const where: SQL[] = [
    gte(posts.scheduledAt, startOfDay(today, tz)),
    lt(posts.scheduledAt, startOfDay(addDays(today, 1), tz)),
    inArray(posts.status, [...LIVE_POST_STATUSES]),
  ];
  if (productId) where.push(eq(briefs.productId, productId));
  const rows = await db
    .select({
      postId: posts.id,
      briefId: briefs.id,
      briefCode: briefs.code,
      briefKind: briefs.kind,
      title: briefs.title,
      platform: channelAccounts.platform,
      accountStatus: channelAccounts.status,
      scheduledAt: posts.scheduledAt,
      audienceTz: posts.audienceTz,
      status: posts.status,
    })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(and(...where))
    .orderBy(asc(posts.scheduledAt), asc(posts.id));
  return rows.map((r) => ({
    postId: r.postId,
    briefId: r.briefId,
    briefCode: r.briefCode,
    briefKind: r.briefKind,
    title: r.title,
    platform: r.platform,
    scheduledAt: r.scheduledAt!.toISOString(),
    audienceTz: r.audienceTz,
    status: r.status,
    delivery: deliveryFor(r.platform, r.accountStatus),
  }));
}

async function nextPosts(productId: string, now: Date): Promise<NextPost[]> {
  const scheduled = await db
    .selectDistinctOn([channelAccounts.platform], {
      platform: channelAccounts.platform,
      postId: posts.id,
      briefId: briefs.id,
      briefCode: briefs.code,
      title: briefs.title,
      at: posts.scheduledAt,
      audienceTz: posts.audienceTz,
    })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
    .where(
      and(
        eq(briefs.productId, productId),
        inArray(posts.status, ['scheduled', 'manual_pending']),
        gte(posts.scheduledAt, now),
      ),
    )
    .orderBy(channelAccounts.platform, asc(posts.scheduledAt));

  const byPlatform = new Map<Platform, NextPost>();
  for (const r of scheduled) {
    byPlatform.set(r.platform, {
      platform: r.platform,
      source: 'post',
      at: r.at!.toISOString(),
      audienceTz: r.audienceTz,
      postId: r.postId,
      briefId: r.briefId,
      briefCode: r.briefCode,
      title: r.title,
    });
  }

  // Channels with posting slots but nothing booked: show the next free slot.
  const slotPlatforms = await db
    .selectDistinct({ platform: postingSlots.platform })
    .from(postingSlots)
    .where(and(eq(postingSlots.productId, productId), eq(postingSlots.active, true)));
  for (const { platform } of slotPlatforms) {
    if (byPlatform.has(platform)) continue;
    try {
      const [slot] = await nextFreeSlots(productId, platform, now, 1);
      if (slot) {
        byPlatform.set(platform, {
          platform,
          source: 'slot',
          at: slot.at.toISOString(),
          audienceTz: slot.audienceTimezone,
          postId: null,
          briefId: null,
          briefCode: null,
          title: null,
        });
      }
    } catch (err) {
      // SETTINGS owns slot maths; if it is not available the card just shows booked posts.
      logger.warn({ err, productId, platform }, 'next free slot not available');
    }
  }
  return PLATFORMS.filter((p) => byPlatform.has(p)).map((p) => byPlatform.get(p)!);
}

/* ---------- Pipeline and products ---------- */

async function pipeline(productId?: string): Promise<PipelineCounts> {
  const rows = await db
    .select({ stage: leads.stage, n: sql<string>`count(*)`.mapWith(toCount) })
    .from(leads)
    .where(productId ? eq(leads.productId, productId) : undefined)
    .groupBy(leads.stage);
  const counts: PipelineCounts = {
    new: 0,
    qualified: 0,
    talking: 0,
    pilot: 0,
    review: 0,
    won: 0,
    lost: 0,
  };
  for (const r of rows) counts[r.stage as LeadStage] = r.n;
  return counts;
}

async function productsThisWeek(weekStartUtc: Date, weekEndUtc: Date): Promise<DashboardProduct[]> {
  const when = sql`coalesce(${posts.publishedAt}, ${posts.scheduledAt})`;
  const pieces = db
    .select({
      productId: briefs.productId,
      n: sql<string>`count(distinct ${briefs.id})`.as('n'),
    })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(
      and(
        inArray(posts.status, [...PIECE_POST_STATUSES]),
        sql`${when} >= ${weekStartUtc}`,
        sql`${when} < ${weekEndUtc}`,
      ),
    )
    .groupBy(briefs.productId)
    .as('pieces');
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      color: products.color,
      status: products.status,
      pieces: sql<string>`coalesce(${pieces.n}, 0)`.mapWith(toCount),
      kitSigned: sql<boolean>`exists (
        select 1 from product_kits k
        where k.product_id = ${products.id} and k.signed_at is not null
          and k.version = (select max(k2.version) from product_kits k2 where k2.product_id = ${products.id})
      )`,
    })
    .from(products)
    .leftJoin(pieces, eq(pieces.productId, products.id))
    .where(ne(products.status, 'archived'))
    .orderBy(asc(products.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    status: r.status,
    piecesThisWeek: r.pieces,
    kitSigned: Boolean(r.kitSigned),
  }));
}

/* ---------- The whole screen ---------- */

export async function buildDashboard(
  req: Request,
  q: { productId?: string | undefined; tz?: string | undefined },
  now = new Date(),
): Promise<DashboardResponse> {
  const viewer = await viewerOf(req);
  const tz = q.tz ?? env.appTimezone;
  const today = dateKey(now, tz);
  const productId = q.productId;

  // Metric snapshot dates are app-zone calendar dates.
  const metricToday = dateKey(now, env.appTimezone);
  const { current, previous } = windows(metricToday, 7);
  const weekStart = weekStartKey(now, env.appTimezone);
  const weekStartUtc = startOfDay(weekStart, env.appTimezone);
  const weekEndUtc = startOfDay(addDays(weekStart, 7), env.appTimezone);

  const openLeadsWhere: SQL[] = [notInArray(leads.stage, ['won', 'lost'])];
  if (productId) openLeadsWhere.push(eq(leads.productId, productId));
  const ideasWhere: SQL[] = [eq(ideas.source, 'claude'), gte(ideas.createdAt, weekStartUtc), sql`${ideas.deletedAt} is null`];
  if (productId) ideasWhere.push(eq(ideas.productId, productId));

  const [
    cur,
    prev,
    openLeads,
    approvalsItems,
    planItemsNeeded,
    keywordItems,
    today_,
    next,
    note,
    newIdeas,
    pipe,
    productList,
  ] = await Promise.all([
    sumTotals(current, productId),
    sumTotals(previous, productId),
    db
      .select({
        open: sql<string>`count(*)`.mapWith(toCount),
        newThisWeek:
          sql<string>`count(*) filter (where ${leads.createdAt} >= ${new Date(now.getTime() - 7 * 86_400_000)})`.mapWith(
            toCount,
          ),
      })
      .from(leads)
      .where(and(...openLeadsWhere)),
    approvalsForMe(viewer, productId),
    plansToFreeze(viewer, today.slice(0, 7), productId),
    keywordComments(viewer, productId),
    goingOutToday(productId, today, tz),
    productId ? nextPosts(productId, now) : Promise.resolve([]),
    latestNote(productId),
    db
      .select({ n: sql<string>`count(*)`.mapWith(toCount) })
      .from(ideas)
      .where(and(...ideasWhere)),
    pipeline(productId),
    productsThisWeek(weekStartUtc, weekEndUtc),
  ]);

  const stat = (c: number, p: number) => ({ value: c, previous: p, deltaPct: deltaPct(c, p) });
  const t = cur.totals;
  const p = prev.totals;
  return {
    productId: productId ?? null,
    today,
    timezone: tz,
    stats: {
      reach7d: stat(t.reach, p.reach),
      savesShares7d: stat(t.saves + t.shares, p.saves + p.shares),
      installs7d: stat(t.installs, p.installs),
      openLeads: { value: openLeads[0]?.open ?? 0, newThisWeek: openLeads[0]?.newThisWeek ?? 0 },
    },
    needsYou: [...approvalsItems, ...planItemsNeeded, ...keywordItems],
    goingOutToday: today_,
    nextPosts: next,
    claudeThisWeek: { note: note.note, newIdeasThisWeek: newIdeas[0]?.n ?? 0 },
    pipeline: pipe,
    products: productList,
  };
}
