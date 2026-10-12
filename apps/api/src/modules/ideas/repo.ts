/**
 * Database reads and DTO mapping for ideas, plans, plan items and occasions.
 */
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type {
  ContentMode,
  Idea,
  IdeaStatus,
  Occasion,
  PlanItemView,
  PlanView,
  UserRef,
} from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import {
  briefs,
  ideas,
  occasionProducts,
  occasions,
  planItems,
  plans,
  users,
} from '../../db/schema/index.js';
import { iso } from '../../lib/time.js';

export type IdeaRow = typeof ideas.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type PlanItemRow = typeof planItems.$inferSelect;
type OccasionRow = typeof occasions.$inferSelect;

/* ---------- Users ---------- */

export async function userRefs(ids: readonly (string | null)[], tx: DbOrTx = db): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name, initials: users.initials })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/* ---------- Ideas ---------- */

/** First brief made from each idea (an idea becomes at most one brief). */
async function briefsForIdeas(ideaIds: readonly string[], tx: DbOrTx): Promise<Map<string, { id: string; code: string }>> {
  if (ideaIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: briefs.id, code: briefs.code, ideaId: briefs.ideaId })
    .from(briefs)
    .where(inArray(briefs.ideaId, [...ideaIds]))
    .orderBy(asc(briefs.createdAt));
  const map = new Map<string, { id: string; code: string }>();
  for (const r of rows) if (r.ideaId && !map.has(r.ideaId)) map.set(r.ideaId, { id: r.id, code: r.code });
  return map;
}

export async function toIdeaDtos(rows: readonly IdeaRow[], tx: DbOrTx = db): Promise<Idea[]> {
  const [people, briefMap] = await Promise.all([
    userRefs(rows.map((r) => r.createdById), tx),
    briefsForIdeas(
      rows.map((r) => r.id),
      tx,
    ),
  ]);
  return rows.map((r) => {
    const brief = briefMap.get(r.id) ?? null;
    return {
      id: r.id,
      productId: r.productId,
      title: r.title,
      summary: r.summary,
      mode: r.mode,
      channels: r.channels,
      fitScore: r.fitScore,
      status: r.status,
      source: r.source,
      note: r.note,
      angle: r.angle,
      briefId: brief?.id ?? null,
      briefCode: brief?.code ?? null,
      createdBy: r.createdById ? (people.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

export async function toIdeaDto(row: IdeaRow, tx: DbOrTx = db): Promise<Idea> {
  const [dto] = await toIdeaDtos([row], tx);
  return dto!;
}

/** A live idea (soft-deleted ideas are gone for every screen; they stay in the content memory). */
export async function findIdea(id: string, tx: DbOrTx = db): Promise<IdeaRow | null> {
  const [row] = await tx.select().from(ideas).where(and(eq(ideas.id, id), isNull(ideas.deletedAt))).limit(1);
  return row ?? null;
}

export interface IdeaFilter {
  productId: string;
  status?: IdeaStatus | undefined;
  mode?: ContentMode | undefined;
  limit: number;
  offset: number;
}

/** Board order: fit score high first, then newest. */
export async function listIdeas(f: IdeaFilter): Promise<{ items: Idea[]; total: number }> {
  const conds: SQL[] = [eq(ideas.productId, f.productId), isNull(ideas.deletedAt)];
  if (f.status) conds.push(eq(ideas.status, f.status));
  if (f.mode) conds.push(eq(ideas.mode, f.mode));
  const where = and(...conds);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(ideas)
      .where(where)
      .orderBy(sql`${ideas.fitScore} desc nulls last`, desc(ideas.createdAt), asc(ideas.id))
      .limit(f.limit)
      .offset(f.offset),
    db.select({ n: count() }).from(ideas).where(where),
  ]);
  return { items: await toIdeaDtos(rows), total: totalRow?.n ?? 0 };
}

/** Titles already used for a product (ideas and briefs), newest first, for the prompt. */
export async function usedTitles(productId: string, limit = 150): Promise<string[]> {
  const [ideaRows, briefRows] = await Promise.all([
    db
      .select({ title: ideas.title })
      .from(ideas)
      .where(eq(ideas.productId, productId))
      .orderBy(desc(ideas.createdAt))
      .limit(limit),
    db
      .select({ title: briefs.title })
      .from(briefs)
      .where(eq(briefs.productId, productId))
      .orderBy(desc(briefs.createdAt))
      .limit(limit),
  ]);
  return [...new Set([...ideaRows, ...briefRows].map((r) => r.title))].slice(0, limit);
}

/* ---------- Occasions ---------- */

async function occasionProductIds(ids: readonly string[], tx: DbOrTx): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select()
    .from(occasionProducts)
    .where(inArray(occasionProducts.occasionId, [...ids]));
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.occasionId, [...(map.get(r.occasionId) ?? []), r.productId]);
  return map;
}

export async function toOccasionDtos(rows: readonly OccasionRow[], tx: DbOrTx = db): Promise<Occasion[]> {
  const productIds = await occasionProductIds(
    rows.map((r) => r.id),
    tx,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    date: r.date,
    endDate: r.endDate,
    notes: r.notes,
    productIds: (productIds.get(r.id) ?? []).sort(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Occasions that touch the range [from, to]. With a product, only occasions linked to it
 * or linked to no product at all (ecosystem-wide days).
 */
export async function listOccasions(from: string, to: string, productId?: string): Promise<Occasion[]> {
  const overlaps = and(
    lte(occasions.date, to),
    gte(sql`coalesce(${occasions.endDate}, ${occasions.date})`, from),
  );
  const forProduct = productId
    ? or(
        sql`exists (select 1 from ${occasionProducts} op where op.occasion_id = ${occasions.id} and op.product_id = ${productId})`,
        sql`not exists (select 1 from ${occasionProducts} op where op.occasion_id = ${occasions.id})`,
      )
    : undefined;
  const rows = await db
    .select()
    .from(occasions)
    .where(forProduct ? and(overlaps, forProduct) : overlaps)
    .orderBy(asc(occasions.date), asc(occasions.name));
  return toOccasionDtos(rows);
}

/* ---------- Plans ---------- */

export async function findPlan(id: string, tx: DbOrTx = db): Promise<PlanRow | null> {
  const [row] = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  return row ?? null;
}

export async function findPlanByMonth(productId: string, month: string, tx: DbOrTx = db): Promise<PlanRow | null> {
  const [row] = await tx
    .select()
    .from(plans)
    .where(and(eq(plans.productId, productId), eq(plans.month, month)))
    .limit(1);
  return row ?? null;
}

export async function findPlanItem(id: string, tx: DbOrTx = db): Promise<PlanItemRow | null> {
  const [row] = await tx.select().from(planItems).where(eq(planItems.id, id)).limit(1);
  return row ?? null;
}

export async function planItemsOf(planId: string, tx: DbOrTx = db): Promise<PlanItemRow[]> {
  return tx
    .select()
    .from(planItems)
    .where(eq(planItems.planId, planId))
    .orderBy(asc(planItems.date), asc(planItems.position), asc(planItems.createdAt));
}

export function toPlanItemView(r: PlanItemRow, briefCode: string | null): PlanItemView {
  return {
    id: r.id,
    planId: r.planId,
    date: r.date,
    title: r.title,
    mode: r.mode,
    channel: r.channel,
    ideaId: r.ideaId,
    briefId: r.briefId,
    occasionId: r.occasionId,
    needsShootSlot: r.needsShootSlot,
    position: r.position,
    briefCode,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function briefCodes(ids: readonly (string | null)[], tx: DbOrTx = db): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: briefs.id, code: briefs.code })
    .from(briefs)
    .where(inArray(briefs.id, unique));
  return new Map(rows.map((r) => [r.id, r.code]));
}

export async function toPlanView(plan: PlanRow, tx: DbOrTx = db): Promise<PlanView> {
  const items = await planItemsOf(plan.id, tx);
  const [codes, people] = await Promise.all([
    briefCodes(
      items.map((i) => i.briefId),
      tx,
    ),
    userRefs([plan.frozenById], tx),
  ]);
  return {
    id: plan.id,
    productId: plan.productId,
    month: plan.month,
    status: plan.status,
    frozenAt: iso(plan.frozenAt),
    frozenBy: plan.frozenById ? (people.get(plan.frozenById) ?? null) : null,
    items: items.map((i) => toPlanItemView(i, i.briefId ? (codes.get(i.briefId) ?? null) : null)),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** Items that should get a brief when the plan freezes. */
export async function itemsNeedingBrief(planId: string, tx: DbOrTx): Promise<PlanItemRow[]> {
  return tx
    .select()
    .from(planItems)
    .where(and(eq(planItems.planId, planId), isNotNull(planItems.ideaId), sql`${planItems.briefId} is null`))
    .orderBy(asc(planItems.date), asc(planItems.position));
}
