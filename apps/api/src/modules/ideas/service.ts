/**
 * Ideas, plans, plan items and occasions: every change, with its rules and audit log.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type Brief,
  type Idea,
  type IdeaCreate,
  type IdeaStatus,
  type Occasion,
  type PlanChecks,
  type PlanFreezeResponse,
  type PlanItemView,
  type PlanView,
  type WeeklyProposal,
  type ContentMode,
  type Platform,
} from '@growth-desk/contract';
import { db, type Tx } from '../../db/client.js';
import {
  ideas,
  occasionProducts,
  occasions,
  planItems,
  plans,
  productKits,
  productSettings,
  products,
  weeklyRuns,
} from '../../db/schema/index.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import { AppError, badRequest, conflict, notFound, unprocessable } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { iso, isValidTimeZone, weekStartKey } from '../../lib/time.js';
import { checkDuplicate, embeddingText, remember, withMemoryLock } from '../../lib/content-memory.js';
import { embedText } from '../../lib/embeddings.js';
import { createBriefFromIdea } from '../make/shared.js';
import { guardRepeat } from '../memory/guard.js';
import {
  computePlanChecks,
  crossProductWarnings,
  isDateInMonth,
  monthRange,
  type OtherProductPlan,
} from './plan-checks.js';
import {
  briefCodes,
  findIdea,
  itemsNeedingBrief,
  listOccasions,
  planItemsOf,
  toIdeaDto,
  toOccasionDtos,
  toPlanItemView,
  toPlanView,
  type IdeaRow,
  type PlanItemRow,
  type PlanRow,
} from './repo.js';

export type AuditCtx = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;

const planFrozen = () =>
  conflict('This month is frozen. Ask an admin to unfreeze it before changing it.', 'PLAN_FROZEN');

const statusNotAllowed = (detail: string) => conflict(detail, 'IDEA_STATUS_NOT_ALLOWED');

function snapshotIdea(r: IdeaRow) {
  return { title: r.title, summary: r.summary, mode: r.mode, channels: r.channels, fitScore: r.fitScore, status: r.status, note: r.note, angle: r.angle };
}

/* ---------- Ideas ---------- */

/**
 * New idea by hand. Checked against the content memory of every product under the memory lock:
 * a duplicate is refused (409 IDEA_DUPLICATE), a similar one needs `similarReason`.
 */
export async function createIdea(input: IdeaCreate, ctx: AuditCtx): Promise<Idea> {
  const summary = input.summary ?? null;
  const embedding = await embedText(embeddingText('idea', input.title, summary));
  return db.transaction((tx) =>
    withMemoryLock(tx, async () => {
      const check = await checkDuplicate({ kind: 'idea', title: input.title, body: summary, productId: input.productId, embedding }, tx);
      const decision = guardRepeat(check, { field: 'body.title', similarReason: input.similarReason });
      const [row] = await tx
        .insert(ideas)
        .values({
          productId: input.productId,
          title: input.title,
          summary,
          mode: input.mode,
          channels: [...new Set(input.channels)],
          fitScore: input.fitScore ?? null,
          status: 'new',
          source: 'human',
          createdById: ctx.actorId ?? null,
        })
        .returning();
      await remember(
        { sourceType: 'idea', sourceId: row!.id, productId: row!.productId, title: row!.title, body: summary, mode: row!.mode, embedding },
        tx,
      );
      await writeAudit(
        { ...ctx, action: 'idea.create', entity: 'idea', entityId: row!.id, after: { ...snapshotIdea(row!), memory: decision } },
        tx,
      );
      return toIdeaDto(row!, tx);
    }),
  );
}

export interface IdeaPatch {
  title?: string | undefined;
  summary?: string | null | undefined;
  mode?: ContentMode | undefined;
  channels?: Platform[] | undefined;
  fitScore?: number | null | undefined;
  similarReason?: string | undefined;
}

export async function updateIdea(row: IdeaRow, patch: IdeaPatch, ctx: AuditCtx): Promise<Idea> {
  if (row.status === 'briefed') throw statusNotAllowed('This idea is already a brief. Edit the brief instead.');
  const set: Partial<typeof ideas.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.summary !== undefined) set.summary = patch.summary;
  if (patch.mode !== undefined) set.mode = patch.mode;
  if (patch.channels !== undefined) set.channels = [...new Set(patch.channels)];
  if (patch.fitScore !== undefined) set.fitScore = patch.fitScore;
  const titleChanged = patch.title !== undefined && patch.title !== row.title;
  const summary = patch.summary !== undefined ? patch.summary : row.summary;
  const embedding = titleChanged ? await embedText(embeddingText('idea', patch.title!, summary)) : null;
  return db.transaction((tx) =>
    withMemoryLock(tx, async () => {
      let decision = null;
      if (titleChanged) {
        const check = await checkDuplicate(
          { kind: 'idea', title: patch.title!, body: summary, productId: row.productId, excludeSourceIds: [row.id], embedding },
          tx,
        );
        decision = guardRepeat(check, { field: 'body.title', similarReason: patch.similarReason });
      }
      const [updated] = await tx
        .update(ideas)
        .set(set)
        .where(and(eq(ideas.id, row.id), sql`${ideas.status} <> 'briefed'`, sql`${ideas.deletedAt} is null`))
        .returning();
      if (!updated) throw statusNotAllowed('This idea is already a brief. Edit the brief instead.');
      if (titleChanged || patch.summary !== undefined || patch.mode !== undefined) {
        await remember(
          {
            sourceType: 'idea',
            sourceId: updated.id,
            productId: updated.productId,
            title: updated.title,
            body: updated.summary,
            angle: updated.angle,
            mode: updated.mode,
            embedding: titleChanged ? embedding : undefined,
          },
          tx,
        );
      }
      await writeAudit(
        {
          ...ctx,
          action: 'idea.update',
          entity: 'idea',
          entityId: row.id,
          before: snapshotIdea(row),
          after: { ...snapshotIdea(updated), ...(decision ? { memory: decision } : {}) },
        },
        tx,
      );
      return toIdeaDto(updated, tx);
    }),
  );
}

/** Moves an idea between statuses only when it is in one of `from` (safe against races). */
async function moveIdea(
  row: IdeaRow,
  from: readonly IdeaStatus[],
  to: IdeaStatus,
  note: string | null | undefined,
  action: string,
  ctx: AuditCtx,
  denied: string,
): Promise<Idea> {
  if (!from.includes(row.status)) throw statusNotAllowed(denied);
  return db.transaction(async (tx) => {
    const set: Partial<typeof ideas.$inferInsert> = { status: to };
    if (note !== undefined) set.note = note;
    const [updated] = await tx
      .update(ideas)
      .set(set)
      .where(and(eq(ideas.id, row.id), inArray(ideas.status, [...from])))
      .returning();
    if (!updated) throw statusNotAllowed(denied);
    await writeAudit(
      { ...ctx, action, entity: 'idea', entityId: row.id, before: { status: row.status, note: row.note }, after: { status: updated.status, note: updated.note } },
      tx,
    );
    return toIdeaDto(updated, tx);
  });
}

export function starIdea(row: IdeaRow, starred: boolean, ctx: AuditCtx): Promise<Idea> {
  return starred
    ? moveIdea(row, ['new', 'starred'], 'starred', undefined, 'idea.star', ctx, 'Only a new idea can be starred.')
    : moveIdea(row, ['starred'], 'new', undefined, 'idea.unstar', ctx, 'Only a starred idea can be unstarred.');
}

export function parkIdea(row: IdeaRow, reason: string, ctx: AuditCtx): Promise<Idea> {
  return moveIdea(row, ['new', 'starred'], 'parked', reason, 'idea.park', ctx, 'Only a new or starred idea can be parked.');
}

export function unparkIdea(row: IdeaRow, ctx: AuditCtx): Promise<Idea> {
  return moveIdea(row, ['parked'], 'new', null, 'idea.unpark', ctx, 'Only a parked idea can be brought back.');
}

/**
 * Soft delete: the idea leaves every list but stays in the content memory, so its title is
 * never suggested again.
 */
export async function deleteIdea(row: IdeaRow, ctx: AuditCtx): Promise<void> {
  if (row.status === 'briefed') throw statusNotAllowed('This idea is already a brief, so it is kept for the record.');
  await db.transaction(async (tx) => {
    const deleted = await tx
      .update(ideas)
      .set({ deletedAt: new Date() })
      .where(and(eq(ideas.id, row.id), sql`${ideas.status} <> 'briefed'`, sql`${ideas.deletedAt} is null`))
      .returning({ id: ideas.id });
    if (deleted.length === 0) throw statusNotAllowed('This idea is already a brief, so it is kept for the record.');
    await writeAudit({ ...ctx, action: 'idea.delete', entity: 'idea', entityId: row.id, before: snapshotIdea(row), after: { deleted: 'soft' } }, tx);
  });
}

/** "Open as brief": MAKE creates the brief, marks the idea briefed and writes its audit log. */
export async function openIdeaAsBrief(row: IdeaRow, actorId: string): Promise<Brief> {
  if (row.status === 'briefed') throw statusNotAllowed('This idea is already a brief.');
  if (row.status === 'parked') throw statusNotAllowed('Bring the idea back from parked before you brief it.');
  return createBriefFromIdea({ ideaId: row.id, actorId });
}

/** The latest weekly run of this product's current week that created ideas. */
export async function latestWeeklyProposal(productId: string, now = new Date()): Promise<WeeklyProposal | null> {
  const [settings] = await db
    .select({ timezone: productSettings.timezone })
    .from(productSettings)
    .where(eq(productSettings.productId, productId))
    .limit(1);
  const tz = settings && isValidTimeZone(settings.timezone) ? settings.timezone : env.appTimezone;
  const [run] = await db
    .select()
    .from(weeklyRuns)
    .where(and(eq(weeklyRuns.productId, productId), eq(weeklyRuns.weekStart, weekStartKey(now, tz)), sql`${weeklyRuns.ideasCreated} > 0`))
    .orderBy(desc(weeklyRuns.createdAt))
    .limit(1);
  if (!run) return null;
  return {
    runId: run.id,
    weekStart: run.weekStart,
    ideasCreated: run.ideasCreated,
    githubPrUrl: run.githubPrUrl,
    finishedAt: iso(run.finishedAt),
  };
}

/* ---------- Plans ---------- */

export async function getPlanView(productId: string, month: string): Promise<PlanView | null> {
  const [plan] = await db
    .select()
    .from(plans)
    .where(and(eq(plans.productId, productId), eq(plans.month, month)))
    .limit(1);
  return plan ? toPlanView(plan) : null;
}

export async function createPlan(productId: string, month: string, ctx: AuditCtx): Promise<PlanView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(plans).values({ productId, month, status: 'draft' }).onConflictDoNothing().returning();
    if (!row) throw conflict(`A plan for ${month} already exists.`, 'PLAN_EXISTS');
    await writeAudit({ ...ctx, action: 'plan.create', entity: 'plan', entityId: row.id, after: { productId, month } }, tx);
    return toPlanView(row, tx);
  });
}

function assertDraft(plan: PlanRow): void {
  if (plan.status === 'frozen') throw planFrozen();
}

function assertInMonth(date: string, plan: PlanRow, field = 'body.date'): void {
  if (!isDateInMonth(date, plan.month)) {
    throw badRequest('The day must be inside the plan month.', 'VALIDATION_FAILED', [
      { path: field, message: `Pick a day in ${plan.month}` },
    ]);
  }
}

/** Locks the plan row for the rest of the transaction so freeze and edits cannot interleave. */
async function lockPlan(tx: Tx, planId: string): Promise<PlanRow> {
  const [row] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update').limit(1);
  if (!row) throw notFound('Plan');
  return row;
}

export interface NewPlanItem {
  date: string;
  title?: string | undefined;
  mode?: ContentMode | null | undefined;
  channel?: Platform | null | undefined;
  ideaId?: string | null | undefined;
  occasionId?: string | null | undefined;
  needsShootSlot?: boolean | undefined;
}

async function itemView(row: PlanItemRow, tx: Tx): Promise<PlanItemView> {
  const codes = await briefCodes([row.briefId], tx);
  return toPlanItemView(row, row.briefId ? (codes.get(row.briefId) ?? null) : null);
}

export async function addPlanItem(planId: string, input: NewPlanItem, ctx: AuditCtx): Promise<PlanItemView> {
  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    assertDraft(plan);
    assertInMonth(input.date, plan);

    let idea: IdeaRow | null = null;
    if (input.ideaId) {
      idea = await findIdea(input.ideaId, tx);
      if (!idea || idea.productId !== plan.productId) {
        throw unprocessable('That idea does not belong to this product.', 'IDEA_NOT_USABLE');
      }
      if (idea.status === 'parked') throw unprocessable('A parked idea cannot go on the plan.', 'IDEA_NOT_USABLE');
    }
    if (input.occasionId) {
      const [occ] = await tx.select({ id: occasions.id }).from(occasions).where(eq(occasions.id, input.occasionId)).limit(1);
      if (!occ) throw unprocessable('That occasion does not exist.', 'OCCASION_NOT_FOUND');
    }
    const title = input.title ?? idea?.title;
    if (!title) throw badRequest('Give a title or pick an idea.');

    const [pos] = await tx
      .select({ next: sql<number>`coalesce(max(${planItems.position}) + 1, 0)::int` })
      .from(planItems)
      .where(and(eq(planItems.planId, plan.id), eq(planItems.date, input.date)));

    const [row] = await tx
      .insert(planItems)
      .values({
        planId: plan.id,
        date: input.date,
        title,
        mode: input.mode !== undefined ? input.mode : (idea?.mode ?? null),
        channel: input.channel !== undefined ? input.channel : (idea?.channels[0] ?? null),
        ideaId: idea?.id ?? null,
        briefId: null,
        occasionId: input.occasionId ?? null,
        needsShootSlot: input.needsShootSlot ?? false,
        position: pos?.next ?? 0,
      })
      .returning();
    await writeAudit({ ...ctx, action: 'plan_item.create', entity: 'plan_item', entityId: row!.id, after: row }, tx);
    return itemView(row!, tx);
  });
}

export interface PlanItemPatch {
  date?: string | undefined;
  title?: string | undefined;
  mode?: ContentMode | null | undefined;
  channel?: Platform | null | undefined;
  needsShootSlot?: boolean | undefined;
  position?: number | undefined;
}

export async function updatePlanItem(item: PlanItemRow, patch: PlanItemPatch, ctx: AuditCtx): Promise<PlanItemView> {
  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, item.planId);
    assertDraft(plan);
    if (patch.date !== undefined) assertInMonth(patch.date, plan);
    const set: Partial<typeof planItems.$inferInsert> = {};
    for (const key of ['date', 'title', 'mode', 'channel', 'needsShootSlot', 'position'] as const) {
      if (patch[key] !== undefined) Object.assign(set, { [key]: patch[key] });
    }
    const [row] = await tx.update(planItems).set(set).where(eq(planItems.id, item.id)).returning();
    if (!row) throw notFound('Plan item');
    await writeAudit({ ...ctx, action: 'plan_item.update', entity: 'plan_item', entityId: item.id, before: item, after: row }, tx);
    return itemView(row, tx);
  });
}

export async function deletePlanItem(item: PlanItemRow, ctx: AuditCtx): Promise<void> {
  await db.transaction(async (tx) => {
    const plan = await lockPlan(tx, item.planId);
    assertDraft(plan);
    await tx.delete(planItems).where(eq(planItems.id, item.id));
    await writeAudit({ ...ctx, action: 'plan_item.delete', entity: 'plan_item', entityId: item.id, before: item }, tx);
  });
}

/**
 * Freeze the month: locks it, then every item with an idea and no brief gets one
 * (MAKE's `createBriefFromIdea`). An idea that is already a brief links that brief instead.
 * All in one transaction: if one brief fails, nothing is frozen.
 */
export async function freezePlan(planId: string, actorId: string, ctx: AuditCtx): Promise<PlanFreezeResponse> {
  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    if (plan.status === 'frozen') throw conflict('This month is already frozen.', 'PLAN_FROZEN');

    const pending = await itemsNeedingBrief(plan.id, tx);
    let briefsCreated = 0;
    const briefOfIdea = new Map<string, string>();
    for (const item of pending) {
      const ideaId = item.ideaId!;
      let briefId = briefOfIdea.get(ideaId);
      if (!briefId) {
        const existing = await tx.execute<{ id: string }>(
          sql`select id from briefs where idea_id = ${ideaId} order by created_at limit 1`,
        );
        briefId = existing.rows[0]?.id;
      }
      if (!briefId) {
        const brief = await createBriefFromIdea({ ideaId, actorId, planItemId: item.id }, tx);
        briefId = brief.id;
        briefsCreated += 1;
      }
      briefOfIdea.set(ideaId, briefId);
      await tx.update(planItems).set({ briefId }).where(and(eq(planItems.id, item.id), sql`${planItems.briefId} is null`));
    }

    const [frozen] = await tx
      .update(plans)
      .set({ status: 'frozen', frozenAt: new Date(), frozenById: actorId })
      .where(eq(plans.id, plan.id))
      .returning();
    const items = await planItemsOf(plan.id, tx);
    const itemsWithoutIdea = items.filter((i) => !i.ideaId && !i.briefId).length;
    await writeAudit(
      {
        ...ctx,
        action: 'plan.freeze',
        entity: 'plan',
        entityId: plan.id,
        before: { status: plan.status },
        after: { status: 'frozen', briefsCreated, linkedItems: pending.map((p) => p.id), itemsWithoutIdea },
      },
      tx,
    );
    return { plan: await toPlanView(frozen!, tx), briefsCreated, itemsWithoutIdea };
  });
}

export async function unfreezePlan(planId: string, ctx: AuditCtx): Promise<PlanView> {
  return db.transaction(async (tx) => {
    const plan = await lockPlan(tx, planId);
    if (plan.status !== 'frozen') throw conflict('This month is not frozen.', 'PLAN_NOT_FROZEN');
    const [row] = await tx
      .update(plans)
      .set({ status: 'draft', frozenAt: null, frozenById: null })
      .where(eq(plans.id, plan.id))
      .returning();
    await writeAudit(
      {
        ...ctx,
        action: 'plan.unfreeze',
        entity: 'plan',
        entityId: plan.id,
        before: { status: 'frozen', frozenAt: plan.frozenAt, frozenById: plan.frozenById },
        after: { status: 'draft' },
      },
      tx,
    );
    return toPlanView(row!, tx);
  });
}

export async function planChecks(plan: PlanRow): Promise<PlanChecks> {
  const [product] = await db.select({ name: products.name }).from(products).where(eq(products.id, plan.productId)).limit(1);
  const items = await planItemsOf(plan.id);
  const { first, last } = monthRange(plan.month);
  const result = computePlanChecks(plan.month, items, product?.name ?? 'this product');
  const others = await otherSignedProductPlans(plan.productId, plan.month);
  return {
    planId: plan.id,
    ...result,
    warnings: [...result.warnings, ...crossProductWarnings(plan.month, others)],
    occasions: await listOccasions(first, last, plan.productId),
  };
}

/**
 * Other live products whose newest kit version is signed, with the dates of their plan items
 * in `month` (empty when they have no plan yet). Feeds the cross-product check.
 */
async function otherSignedProductPlans(productId: string, month: string): Promise<OtherProductPlan[]> {
  const signed = await db.execute<{ id: string; name: string }>(sql`
    select p.id, p.short_name as name
    from ${products} p
    join lateral (
      select k.signed_at from ${productKits} k
      where k.product_id = p.id
      order by k.version desc
      limit 1
    ) latest on true
    where p.id <> ${productId}
      and p.status <> 'archived'
      and latest.signed_at is not null`);
  if (signed.rows.length === 0) return [];
  const ids = signed.rows.map((r) => r.id);
  const dated = await db
    .select({ productId: plans.productId, date: planItems.date })
    .from(planItems)
    .innerJoin(plans, eq(plans.id, planItems.planId))
    .where(and(inArray(plans.productId, ids), eq(plans.month, month)));
  return signed.rows.map((r) => ({
    productId: r.id,
    name: r.name,
    dates: dated.filter((d) => d.productId === r.id).map((d) => d.date),
  }));
}

/* ---------- Occasions ---------- */

export interface NewOccasion {
  name: string;
  date: string;
  endDate?: string | null | undefined;
  notes?: string | null | undefined;
  productIds: string[];
}

export async function createOccasion(input: NewOccasion, ctx: AuditCtx): Promise<Occasion> {
  const productIds = [...new Set(input.productIds)];
  return db.transaction(async (tx) => {
    if (productIds.length > 0) {
      const found = await tx.select({ id: products.id }).from(products).where(inArray(products.id, productIds));
      if (found.length !== productIds.length) {
        throw new AppError({
          status: 400,
          code: 'VALIDATION_FAILED',
          title: 'Validation failed',
          detail: 'One of the products does not exist.',
          errors: [{ path: 'body.productIds', message: 'Unknown product' }],
        });
      }
    }
    const [row] = await tx
      .insert(occasions)
      .values({ name: input.name, date: input.date, endDate: input.endDate ?? null, notes: input.notes ?? null })
      .returning();
    if (productIds.length > 0) {
      await tx.insert(occasionProducts).values(productIds.map((productId) => ({ occasionId: row!.id, productId })));
    }
    await writeAudit({ ...ctx, action: 'occasion.create', entity: 'occasion', entityId: row!.id, after: { ...row, productIds } }, tx);
    const [dto] = await toOccasionDtos([row!], tx);
    return dto!;
  });
}
