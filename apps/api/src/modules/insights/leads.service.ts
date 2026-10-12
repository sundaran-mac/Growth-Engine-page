/**
 * Sales pipeline: leads and lead activities. Minimum personal data, no prices.
 */
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import type {
  CreateLeadActivityRequest,
  LeadActivity,
  LeadActivityListResponse,
  LeadListResponse,
  LeadStage,
  LeadView,
} from '@growth-desk/contract';
import type {
  createLeadRequestSchema,
  listLeadsQuerySchema,
  moveLeadRequestSchema,
  updateLeadRequestSchema,
} from '@growth-desk/contract';
import type { z } from 'zod';
import { db, type DbOrTx } from '../../db/client.js';
import {
  briefs,
  channelAccounts,
  leadActivities,
  leads,
  posts,
  products,
} from '../../db/schema/index.js';
import { auditContext, writeAudit } from '../../lib/audit.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { toCount } from '../../lib/pagination.js';
import { assertProductWriter, LEAD_WRITER_ROLES } from './access.js';
import { actorUsers, ownerUsers, toLead, toLeadActivity, toUserRef } from './mappers.js';

type CreateLead = z.output<typeof createLeadRequestSchema>;
type UpdateLead = z.output<typeof updateLeadRequestSchema>;
type MoveLead = z.output<typeof moveLeadRequestSchema>;
type ListLeads = z.output<typeof listLeadsQuerySchema>;

const sourcePostBriefs = briefs;

function leadViewQuery(tx: DbOrTx = db) {
  return tx
    .select({
      lead: leads,
      owner: { id: ownerUsers.id, name: ownerUsers.name, initials: ownerUsers.initials },
      productName: products.name,
      productShortName: products.shortName,
      productColor: products.color,
      sourcePostBriefCode: sourcePostBriefs.code,
      sourcePostPlatform: channelAccounts.platform,
    })
    .from(leads)
    .innerJoin(products, eq(products.id, leads.productId))
    .leftJoin(ownerUsers, eq(ownerUsers.id, leads.ownerId))
    .leftJoin(posts, eq(posts.id, leads.sourcePostId))
    .leftJoin(sourcePostBriefs, eq(sourcePostBriefs.id, posts.briefId))
    .leftJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId));
}

type LeadViewRow = Awaited<ReturnType<ReturnType<typeof leadViewQuery>['where']>>[number];

function toLeadView(r: LeadViewRow): LeadView {
  return {
    ...toLead(r.lead, toUserRef(r.owner)),
    productName: r.productName,
    productShortName: r.productShortName,
    productColor: r.productColor,
    sourcePostBriefCode: r.sourcePostBriefCode,
    sourcePostPlatform: r.sourcePostPlatform,
  };
}

export async function listLeads(q: ListLeads): Promise<LeadListResponse> {
  const where: SQL[] = [];
  if (q.productId) where.push(eq(leads.productId, q.productId));
  if (q.stage) where.push(eq(leads.stage, q.stage));
  else if (!q.includeLost) where.push(ne(leads.stage, 'lost'));
  const cond = where.length ? and(...where) : undefined;
  const rows = await leadViewQuery()
    .where(cond)
    .orderBy(desc(leads.updatedAt), asc(leads.id))
    .limit(q.limit)
    .offset(q.offset);
  const [count] = await db
    .select({ n: sql<string>`count(*)`.mapWith(toCount) })
    .from(leads)
    .where(cond);
  return { items: rows.map(toLeadView), total: count?.n ?? 0 };
}

export async function getLeadView(id: string, tx: DbOrTx = db): Promise<LeadView> {
  const [row] = await leadViewQuery(tx).where(eq(leads.id, id));
  if (!row) throw notFound('Lead');
  return toLeadView(row);
}

async function loadLead(id: string, tx: DbOrTx = db) {
  const [row] = await tx.select().from(leads).where(eq(leads.id, id));
  if (!row) throw notFound('Lead');
  return row;
}

/** The source post must belong to a brief of the same product. */
async function assertSourcePost(productId: string, postId: string | null | undefined) {
  if (!postId) return;
  const [row] = await db
    .select({ productId: briefs.productId })
    .from(posts)
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(eq(posts.id, postId));
  if (!row) throw badRequest('The source post does not exist.');
  if (row.productId !== productId) throw badRequest('The source post belongs to another product.');
}

export async function createLead(req: Request, body: CreateLead): Promise<LeadView> {
  await assertProductWriter(req, body.productId, LEAD_WRITER_ROLES);
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, body.productId));
  if (!product) throw badRequest('The product does not exist.');
  await assertSourcePost(body.productId, body.sourcePostId);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({
        productId: body.productId,
        organisation: body.organisation,
        source: body.source,
        sourcePostId: body.sourcePostId ?? null,
        sourceText: body.sourceText ?? null,
        who: body.who ?? null,
        firstOffer: body.firstOffer ?? null,
        ownerId: body.ownerId ?? null,
        ownerNote: body.ownerNote ?? null,
        stage: body.stage,
        nextStep: body.nextStep ?? null,
        nextStepAt: body.nextStepAt ? new Date(body.nextStepAt) : null,
      })
      .returning();
    const lead = row!;
    await tx.insert(leadActivities).values({
      leadId: lead.id,
      actorId: req.user?.id ?? null,
      kind: 'note',
      body: 'Lead added by hand.',
    });
    await writeAudit(
      {
        ...auditContext(req),
        action: 'lead.create',
        entity: 'lead',
        entityId: lead.id,
        after: lead,
      },
      tx,
    );
    return getLeadView(lead.id, tx);
  });
}

export async function updateLead(req: Request, id: string, body: UpdateLead): Promise<LeadView> {
  const before = await loadLead(id);
  await assertProductWriter(req, before.productId, LEAD_WRITER_ROLES);
  const set: Partial<typeof leads.$inferInsert> = {};
  if (body.organisation !== undefined) set.organisation = body.organisation;
  if (body.sourceText !== undefined) set.sourceText = body.sourceText;
  if (body.who !== undefined) set.who = body.who;
  if (body.firstOffer !== undefined) set.firstOffer = body.firstOffer;
  if (body.ownerId !== undefined) set.ownerId = body.ownerId;
  if (body.ownerNote !== undefined) set.ownerNote = body.ownerNote;
  if (body.nextStep !== undefined) set.nextStep = body.nextStep;
  if (body.nextStepAt !== undefined)
    set.nextStepAt = body.nextStepAt ? new Date(body.nextStepAt) : null;

  return db.transaction(async (tx) => {
    const [after] = await tx.update(leads).set(set).where(eq(leads.id, id)).returning();
    await writeAudit(
      { ...auditContext(req), action: 'lead.update', entity: 'lead', entityId: id, before, after },
      tx,
    );
    return getLeadView(id, tx);
  });
}

export async function moveLead(req: Request, id: string, body: MoveLead): Promise<LeadView> {
  const before = await loadLead(id);
  await assertProductWriter(req, before.productId, LEAD_WRITER_ROLES);
  if (before.stage === body.stage) {
    throw conflict('The lead is already in this stage.', 'LEAD_STAGE_UNCHANGED');
  }
  return db.transaction(async (tx) => {
    // Guard against a concurrent move: only move from the stage we read.
    const [after] = await tx
      .update(leads)
      .set({ stage: body.stage })
      .where(and(eq(leads.id, id), eq(leads.stage, before.stage)))
      .returning();
    if (!after) throw conflict('The lead was moved by someone else. Reload and try again.');
    await tx.insert(leadActivities).values({
      leadId: id,
      actorId: req.user?.id ?? null,
      kind: 'stage_change',
      body: body.note ?? null,
      fromStage: before.stage,
      toStage: body.stage as LeadStage,
    });
    await writeAudit(
      { ...auditContext(req), action: 'lead.move', entity: 'lead', entityId: id, before, after },
      tx,
    );
    return getLeadView(id, tx);
  });
}

export async function listLeadActivities(
  id: string,
  page: { limit: number; offset: number },
): Promise<LeadActivityListResponse> {
  await loadLead(id);
  const rows = await db
    .select({
      activity: leadActivities,
      actor: { id: actorUsers.id, name: actorUsers.name, initials: actorUsers.initials },
    })
    .from(leadActivities)
    .leftJoin(actorUsers, eq(actorUsers.id, leadActivities.actorId))
    .where(eq(leadActivities.leadId, id))
    .orderBy(desc(leadActivities.createdAt), desc(leadActivities.id))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await db
    .select({ n: sql<string>`count(*)`.mapWith(toCount) })
    .from(leadActivities)
    .where(eq(leadActivities.leadId, id));
  return {
    items: rows.map((r) => toLeadActivity(r.activity, toUserRef(r.actor))),
    total: count?.n ?? 0,
  };
}

export async function addLeadActivity(
  req: Request,
  id: string,
  body: Required<CreateLeadActivityRequest>,
): Promise<LeadActivity> {
  const lead = await loadLead(id);
  await assertProductWriter(req, lead.productId, LEAD_WRITER_ROLES);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leadActivities)
      .values({ leadId: id, actorId: req.user?.id ?? null, kind: body.kind, body: body.body })
      .returning();
    // Logging an activity counts as touching the lead (board sorts by last update).
    await tx.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, id));
    await writeAudit(
      {
        ...auditContext(req),
        action: 'lead.activity',
        entity: 'lead',
        entityId: id,
        after: row,
      },
      tx,
    );
    const user = req.user
      ? { id: req.user.id, name: req.user.name, initials: req.user.initials }
      : null;
    return toLeadActivity(row!, user);
  });
}
