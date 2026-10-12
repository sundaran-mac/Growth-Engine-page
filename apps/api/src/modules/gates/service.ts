/**
 * Review and approvals: business rules (BUILD-PLAN section 7, spec section 8.1).
 *
 * - Send for approval needs the checklist complete for the current version; it creates the two
 *   gates (claims, brand) with a due time from the product approval SLA.
 * - Only the named approver, or the backup after escalation, decides a gate.
 * - Approvals for an older brief version are stale and cannot be decided.
 * - Both gates approved for the current version: brief moves to `approved` and PUBLISH creates
 *   draft posts in the same transaction.
 * - Request changes (or send back from review): brief goes back to `brief`, version + 1.
 * - The escalation timer only escalates; it never approves.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm';
import {
  canMoveBriefStage,
  type ApprovalDetail,
  type ApprovalGate,
  type ApprovalListItem,
  type ApprovalsQuery,
  type BriefStage,
  type CreateReviewCommentRequest,
  type DecideApprovalRequest,
  type DecideApprovalResponse,
  type ListResponse,
  type ReviewChecklistView,
  type ReviewComment,
  type ReviewCommentsQuery,
  type ReviewDetail,
  type ReviewQueueItem,
  type ReviewQueueQuery,
  type SendBackRequest,
  type SendBackResponse,
  type SendForApprovalRequest,
  type SendForApprovalResponse,
  type UpdateChecklistRequest,
  type UpdateReviewCommentRequest,
} from '@growth-desk/contract';
import { db, type DbOrTx, type Tx } from '../../db/client.js';
import { approvals, briefs, reviewChecklists, reviewComments } from '../../db/schema/index.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import type { AppError } from '../../lib/errors.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createNotification, notifyMany } from '../../lib/notifications.js';
import { HOUR_MS } from '../../lib/time.js';
import { createDraftPostsForBrief } from '../publish/shared.js';
import {
  canReadProduct,
  canReviewProduct,
  canSendProduct,
  isAssignedDecider,
  readableProductIds,
  type Actor,
} from './access.js';
import { applyManualTicks, buildChecklist, checklistCounts, openItemsText } from './checklist.js';
import {
  approvalHistory,
  approvalsForVersion,
  gateSettings,
  getBrief,
  loadReviewData,
  openCommentCounts,
  resolveAssignees,
  toApprovals,
  toComments,
  toGateBrief,
  toGateBriefs,
  toMasterAsset,
  type ApprovalRow,
  type BriefRow,
  type CommentRow,
  type ReviewData,
} from './repo.js';

/** Request context for the audit log. */
export type AuditCtx = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;

const GATE_LABEL: Record<ApprovalGate, string> = { claims: 'claims', brand: 'brand' };

const staleVersion = () =>
  conflict('This brief changed since you opened it. Reload and try again.', 'STALE_VERSION');

function stageNotAllowed(detail: string): AppError {
  return conflict(detail, 'STAGE_NOT_ALLOWED');
}

function moveStage(from: BriefStage, to: BriefStage): void {
  if (!canMoveBriefStage(from, to)) {
    throw stageNotAllowed(`A brief cannot move from ${from} to ${to}.`);
  }
}

async function readableBrief(tx: DbOrTx, actor: Actor, briefId: string, lock = false) {
  const brief = await getBrief(tx, briefId, lock);
  if (!brief) throw notFound('Brief');
  if (!canReadProduct(actor, brief.productId)) throw notFound('Brief');
  return brief;
}

function checklistView(brief: BriefRow, data: ReviewData | undefined): ReviewChecklistView {
  const items = data ? buildChecklist(data.inputs, data.stored?.items ?? null) : [];
  const c = checklistCounts(items);
  return {
    version: brief.version,
    items,
    ...c,
    completedAt: c.complete ? (data?.stored?.completedAt?.toISOString() ?? null) : null,
  };
}

/* ---------- Review queue and detail ---------- */

export async function reviewQueue(
  actor: Actor,
  q: ReviewQueueQuery,
): Promise<ListResponse<ReviewQueueItem>> {
  const scope = readableProductIds(actor);
  if (scope !== 'all' && scope.length === 0) return { items: [], total: 0 };
  if (q.productId && !canReadProduct(actor, q.productId)) return { items: [], total: 0 };

  const where = and(
    q.stage ? eq(briefs.stage, q.stage) : inArray(briefs.stage, ['made', 'reviewed']),
    q.productId ? eq(briefs.productId, q.productId) : undefined,
    scope === 'all' ? undefined : inArray(briefs.productId, scope),
  );
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(briefs)
      .where(where)
      .orderBy(asc(briefs.updatedAt), asc(briefs.code))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ n: count() }).from(briefs).where(where),
  ]);
  const [gate, data, open] = await Promise.all([
    toGateBriefs(db, rows),
    loadReviewData(db, rows),
    openCommentCounts(db, rows),
  ]);
  return {
    items: rows.map((b) => {
      const view = checklistView(b, data.get(b.id));
      return {
        brief: gate.get(b.id)!,
        checklistDone: view.done,
        checklistTotal: view.total,
        openComments: open.get(b.id) ?? 0,
      };
    }),
    total: totalRow?.n ?? 0,
  };
}

async function buildReviewDetail(tx: DbOrTx, actor: Actor, brief: BriefRow): Promise<ReviewDetail> {
  // Sequential on purpose: `tx` may be one transaction client.
  const gate = await toGateBrief(tx, brief);
  const data = await loadReviewData(tx, [brief]);
  const current = await approvalsForVersion(tx, brief.id, brief.version);
  const d = data.get(brief.id);
  return {
    brief: gate,
    checklist: checklistView(brief, d),
    master: d?.master ? toMasterAsset(d.master) : null,
    approvals: await toApprovals(tx, current),
    canReview: canReviewProduct(actor, brief.productId),
    canSend: canSendProduct(actor, brief.productId),
  };
}

export async function getReview(actor: Actor, briefId: string): Promise<ReviewDetail> {
  const brief = await readableBrief(db, actor, briefId);
  return buildReviewDetail(db, actor, brief);
}

export async function updateChecklist(
  actor: Actor,
  briefId: string,
  body: UpdateChecklistRequest,
  ctx: AuditCtx,
): Promise<ReviewDetail> {
  return db.transaction(async (tx) => {
    const brief = await readableBrief(tx, actor, briefId, true);
    if (!canReviewProduct(actor, brief.productId)) {
      throw forbidden('You cannot tick this checklist.');
    }
    if (body.version !== brief.version) throw staleVersion();
    if (brief.stage !== 'made') {
      throw stageNotAllowed('The checklist can only change while the piece is in review.');
    }
    const data = (await loadReviewData(tx, [brief])).get(brief.id)!;
    const current = buildChecklist(data.inputs, data.stored?.items ?? null);
    const { items, autoKey } = applyManualTicks(current, body.items);
    if (autoKey) {
      throw badRequest(
        'This item is checked automatically and cannot be ticked by hand.',
        'CHECKLIST_AUTO_ITEM',
        [{ path: 'body.items', message: `${autoKey} is an automatic check` }],
      );
    }
    const { complete } = checklistCounts(items);
    const completedAt = complete ? new Date() : null;
    await tx
      .insert(reviewChecklists)
      .values({ briefId: brief.id, version: brief.version, items, completedAt })
      .onConflictDoUpdate({
        target: [reviewChecklists.briefId, reviewChecklists.version],
        set: { items, completedAt, updatedAt: new Date() },
      });
    await writeAudit(
      {
        ...ctx,
        action: 'review.checklist.update',
        entity: 'brief',
        entityId: brief.id,
        before: { version: brief.version, items: data.stored?.items ?? null },
        after: { version: brief.version, ticks: body.items },
      },
      tx,
    );
    return buildReviewDetail(tx, actor, brief);
  });
}

/* ---------- Comments ---------- */

export async function listComments(
  actor: Actor,
  briefId: string,
  q: ReviewCommentsQuery,
): Promise<ListResponse<ReviewComment>> {
  const brief = await readableBrief(db, actor, briefId);
  const rows = await db
    .select()
    .from(reviewComments)
    .where(
      and(
        eq(reviewComments.briefId, brief.id),
        eq(reviewComments.version, q.version ?? brief.version),
        q.includeResolved ? undefined : eq(reviewComments.resolved, false),
      ),
    )
    .orderBy(
      asc(reviewComments.resolved),
      asc(reviewComments.timecodeMs),
      asc(reviewComments.createdAt),
    );
  const items = await toComments(db, threadOrder(rows));
  return { items, total: items.length };
}

/**
 * Thread order: each root comment (in the order given), then its replies oldest first.
 * A reply whose root is not in the list (filtered out) is dropped, so no reply shows alone.
 */
export function threadOrder<T extends { id: string; parentId: string | null; createdAt: Date }>(
  rows: readonly T[],
): T[] {
  const replies = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = replies.get(r.parentId) ?? [];
    list.push(r);
    replies.set(r.parentId, list);
  }
  const out: T[] = [];
  for (const root of rows) {
    if (root.parentId) continue;
    out.push(root);
    const children = replies.get(root.id) ?? [];
    children.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    out.push(...children);
  }
  return out;
}

export async function createComment(
  actor: Actor,
  briefId: string,
  body: CreateReviewCommentRequest,
  ctx: AuditCtx,
): Promise<ReviewComment> {
  return db.transaction(async (tx) => {
    const brief = await readableBrief(tx, actor, briefId);
    if (!canReviewProduct(actor, brief.productId)) {
      throw forbidden('You cannot comment on this piece.');
    }
    let root: CommentRow | null = null;
    if (body.parentId) {
      const [parent] = await tx
        .select()
        .from(reviewComments)
        .where(eq(reviewComments.id, body.parentId))
        .limit(1);
      if (!parent || parent.briefId !== brief.id || parent.version !== brief.version) {
        throw unprocessable(
          'You can only reply to a comment on this piece and this version.',
          'COMMENT_PARENT_INVALID',
        );
      }
      // One level deep: a reply to a reply attaches to the root of the thread.
      if (parent.parentId) {
        const [top] = await tx
          .select()
          .from(reviewComments)
          .where(eq(reviewComments.id, parent.parentId))
          .limit(1);
        root = top ?? null;
        if (!root) throw unprocessable('This thread no longer exists.', 'COMMENT_PARENT_INVALID');
      } else {
        root = parent;
      }
    }
    const [row] = await tx
      .insert(reviewComments)
      .values({
        briefId: brief.id,
        version: brief.version,
        authorId: actor.id,
        parentId: root?.id ?? null,
        timecodeMs: root ? root.timecodeMs : (body.timecodeMs ?? null),
        body: body.body,
        // A reply joins its thread's state, so a resolved thread stays one unit.
        resolved: root?.resolved ?? false,
        resolvedById: root?.resolvedById ?? null,
        resolvedAt: root?.resolvedAt ?? null,
      })
      .returning();
    await writeAudit(
      {
        ...ctx,
        action: 'review.comment.create',
        entity: 'review_comment',
        entityId: row!.id,
        after: {
          briefId: brief.id,
          version: brief.version,
          timecodeMs: row!.timecodeMs,
          parentId: row!.parentId,
        },
      },
      tx,
    );
    const [comment] = await toComments(tx, [row!]);
    return comment!;
  });
}

export async function updateComment(
  actor: Actor,
  commentId: string,
  body: UpdateReviewCommentRequest,
  ctx: AuditCtx,
): Promise<ReviewComment> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(reviewComments)
      .where(eq(reviewComments.id, commentId))
      .limit(1)
      .for('update');
    if (!existing) throw notFound('Comment');
    const brief = await getBrief(tx, existing.briefId);
    if (!brief || !canReadProduct(actor, brief.productId)) throw notFound('Comment');
    if (!canReviewProduct(actor, brief.productId)) {
      throw forbidden('You cannot change comments on this piece.');
    }
    if (body.body !== undefined && existing.authorId !== actor.id) {
      throw forbidden('Only the author can edit the text of a comment.');
    }
    if (body.resolved !== undefined && existing.parentId) {
      throw unprocessable('Resolve or reopen the thread from its first comment.', 'COMMENT_IS_REPLY');
    }
    const now = new Date();
    const set: Partial<typeof reviewComments.$inferInsert> = { updatedAt: now };
    if (body.body !== undefined) set.body = body.body;
    if (body.resolved !== undefined && body.resolved !== existing.resolved) {
      set.resolved = body.resolved;
      set.resolvedById = body.resolved ? actor.id : null;
      set.resolvedAt = body.resolved ? now : null;
    }
    const [row] = await tx
      .update(reviewComments)
      .set(set)
      .where(eq(reviewComments.id, existing.id))
      .returning();
    let threadReplies = 0;
    if (set.resolved !== undefined) {
      // Resolving (or reopening) a root resolves (or reopens) the whole thread.
      const replies = await tx
        .update(reviewComments)
        .set({
          resolved: set.resolved,
          resolvedById: set.resolvedById ?? null,
          resolvedAt: set.resolvedAt ?? null,
          updatedAt: now,
        })
        .where(eq(reviewComments.parentId, existing.id))
        .returning({ id: reviewComments.id });
      threadReplies = replies.length;
    }
    await writeAudit(
      {
        ...ctx,
        action: 'review.comment.update',
        entity: 'review_comment',
        entityId: existing.id,
        before: { resolved: existing.resolved, body: existing.body },
        after: { resolved: row!.resolved, body: row!.body, threadReplies },
      },
      tx,
    );
    const [comment] = await toComments(tx, [row!]);
    return comment!;
  });
}

/* ---------- Send for approval and send back ---------- */

export async function sendForApproval(
  actor: Actor,
  briefId: string,
  body: SendForApprovalRequest,
  ctx: AuditCtx,
): Promise<SendForApprovalResponse> {
  return db.transaction(async (tx) => {
    const brief = await readableBrief(tx, actor, briefId, true);
    if (!canSendProduct(actor, brief.productId)) {
      throw forbidden('You cannot send this piece for approval.');
    }
    if (body.version !== brief.version) throw staleVersion();
    if (brief.stage !== 'made') {
      throw stageNotAllowed('Only a piece in review can be sent for approval.');
    }
    moveStage(brief.stage, 'reviewed');

    const data = (await loadReviewData(tx, [brief])).get(brief.id)!;
    const items = buildChecklist(data.inputs, data.stored?.items ?? null);
    if (!checklistCounts(items).complete) {
      throw unprocessable(
        `Finish the checklist first. Still open: ${openItemsText(items)}.`,
        'CHECKLIST_INCOMPLETE',
      );
    }

    const assignees = await resolveAssignees(tx, brief);
    if (!assignees.claims.approverId) {
      throw unprocessable(
        'Nobody can approve the claims gate. Set the product owner first.',
        'APPROVER_MISSING',
      );
    }
    if (!assignees.brand.approverId) {
      throw unprocessable(
        'Nobody can approve the brand gate. Mark a brand approver first.',
        'APPROVER_MISSING',
      );
    }
    const { approvalSlaHours } = await gateSettings(brief.productId, tx);
    const now = new Date();
    const dueAt = new Date(now.getTime() + approvalSlaHours * HOUR_MS);

    const created = await tx
      .insert(approvals)
      .values(
        (['claims', 'brand'] as const).map((gate) => ({
          briefId: brief.id,
          version: brief.version,
          gate,
          approverId: assignees[gate].approverId,
          backupId: assignees[gate].backupId,
          requestedAt: now,
          dueAt,
        })),
      )
      .returning();

    await tx
      .insert(reviewChecklists)
      .values({ briefId: brief.id, version: brief.version, items, completedAt: now })
      .onConflictDoUpdate({
        target: [reviewChecklists.briefId, reviewChecklists.version],
        set: { items, completedAt: now, updatedAt: now },
      });

    const [updated] = await tx
      .update(briefs)
      .set({ stage: 'reviewed', updatedAt: now })
      .where(eq(briefs.id, brief.id))
      .returning();

    for (const a of created) {
      await createNotification(
        {
          userId: a.approverId!,
          kind: 'approval_requested',
          title: `${brief.code} needs your ${GATE_LABEL[a.gate]} approval`,
          body: `${brief.title}. Please decide within ${approvalSlaHours} h.`,
          link: `/approvals?id=${a.id}`,
          entity: 'approval',
          entityId: a.id,
        },
        tx,
      );
    }
    await writeAudit(
      {
        ...ctx,
        action: 'approval.request',
        entity: 'brief',
        entityId: brief.id,
        before: { stage: brief.stage, version: brief.version },
        after: {
          stage: 'reviewed',
          version: brief.version,
          approvals: created.map((a) => ({ id: a.id, gate: a.gate, approverId: a.approverId })),
          dueAt,
        },
      },
      tx,
    );
    return { brief: await toGateBrief(tx, updated!), approvals: await toApprovals(tx, created) };
  });
}

/** Back to `brief`, version + 1, freeze cleared. Pending approvals of the old version go stale. */
async function returnToBrief(tx: Tx, brief: BriefRow): Promise<BriefRow> {
  moveStage(brief.stage, 'brief');
  const [updated] = await tx
    .update(briefs)
    .set({ stage: 'brief', version: brief.version + 1, frozenAt: null, updatedAt: new Date() })
    .where(and(eq(briefs.id, brief.id), eq(briefs.version, brief.version)))
    .returning();
  if (!updated) throw staleVersion();
  return updated;
}

export async function sendBack(
  actor: Actor,
  briefId: string,
  body: SendBackRequest,
  ctx: AuditCtx,
): Promise<SendBackResponse> {
  return db.transaction(async (tx) => {
    const brief = await readableBrief(tx, actor, briefId, true);
    if (!canSendProduct(actor, brief.productId)) {
      throw forbidden('You cannot send this piece back to the brief.');
    }
    if (body.version !== brief.version) throw staleVersion();
    if (brief.stage !== 'made' && brief.stage !== 'reviewed') {
      throw stageNotAllowed('Only a piece in review or waiting for approval can be sent back.');
    }
    const pending = (await approvalsForVersion(tx, brief.id, brief.version)).filter(
      (a) => a.decision === 'pending',
    );
    const updated = await returnToBrief(tx, brief);

    // Keep the note next to the version it was about.
    await tx.insert(reviewComments).values({
      briefId: brief.id,
      version: brief.version,
      authorId: actor.id,
      authorLabel: 'Sent back to brief',
      timecodeMs: null,
      body: body.note,
    });
    await notifyMany(
      [brief.ownerId, ...pending.map((a) => a.approverId)].filter((id) => id !== actor.id),
      {
        kind: 'approval_decided',
        title: `${brief.code} went back to the brief`,
        body: body.note,
        link: `/briefs/${brief.id}`,
        entity: 'brief',
        entityId: brief.id,
      },
      tx,
    );
    await writeAudit(
      {
        ...ctx,
        action: 'brief.send_back',
        entity: 'brief',
        entityId: brief.id,
        before: { stage: brief.stage, version: brief.version },
        after: { stage: updated.stage, version: updated.version, note: body.note },
      },
      tx,
    );
    return { brief: await toGateBrief(tx, updated) };
  });
}

/* ---------- Approvals ---------- */

function canDecideNow(actor: Actor, a: ApprovalRow, brief: BriefRow): boolean {
  return (
    a.decision === 'pending' &&
    a.version === brief.version &&
    brief.stage === 'reviewed' &&
    isAssignedDecider(actor, a)
  );
}

async function toListItems(
  tx: DbOrTx,
  actor: Actor,
  rows: readonly ApprovalRow[],
): Promise<ApprovalListItem[]> {
  if (rows.length === 0) return [];
  const briefRows = await tx
    .select()
    .from(briefs)
    .where(inArray(briefs.id, [...new Set(rows.map((r) => r.briefId))]));
  const briefById = new Map(briefRows.map((b) => [b.id, b]));
  const gate = await toGateBriefs(tx, briefRows);
  const list = await toApprovals(tx, rows);
  return rows.map((r, i) => {
    const b = briefById.get(r.briefId)!;
    return {
      ...list[i]!,
      brief: gate.get(r.briefId)!,
      stale: r.version !== b.version,
      canDecide: canDecideNow(actor, r, b),
    };
  });
}

export async function listApprovals(
  actor: Actor,
  q: ApprovalsQuery,
): Promise<ListResponse<ApprovalListItem>> {
  const conds: (SQL | undefined)[] = [
    q.decision ? eq(approvals.decision, q.decision) : undefined,
    q.gate ? eq(approvals.gate, q.gate) : undefined,
    q.briefId ? eq(approvals.briefId, q.briefId) : undefined,
    q.productId ? eq(briefs.productId, q.productId) : undefined,
    q.includeStale ? undefined : eq(approvals.version, briefs.version),
  ];
  if (q.mine) {
    conds.push(
      or(
        eq(approvals.approverId, actor.id),
        and(eq(approvals.backupId, actor.id), isNotNull(approvals.escalatedAt)),
      ),
    );
  } else {
    const scope = readableProductIds(actor);
    if (scope !== 'all') {
      if (scope.length === 0) return { items: [], total: 0 };
      conds.push(inArray(briefs.productId, scope));
    }
  }
  const where = and(...conds);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({ approval: approvals })
      .from(approvals)
      .innerJoin(briefs, eq(briefs.id, approvals.briefId))
      .where(where)
      .orderBy(asc(approvals.requestedAt), asc(approvals.id))
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ n: count() })
      .from(approvals)
      .innerJoin(briefs, eq(briefs.id, approvals.briefId))
      .where(where),
  ]);
  return {
    items: await toListItems(
      db,
      actor,
      rows.map((r) => r.approval),
    ),
    total: totalRow?.n ?? 0,
  };
}

async function readableApproval(tx: DbOrTx, actor: Actor, id: string, lock = false) {
  const q = tx.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw notFound('Approval');
  const brief = await getBrief(tx, row.briefId);
  if (!brief) throw notFound('Approval');
  const assigned = row.approverId === actor.id || row.backupId === actor.id;
  if (!assigned && !canReadProduct(actor, brief.productId)) throw notFound('Approval');
  return { row, brief };
}

async function buildApprovalDetail(
  tx: DbOrTx,
  actor: Actor,
  row: ApprovalRow,
  brief: BriefRow,
): Promise<ApprovalDetail> {
  const [item] = await toListItems(tx, actor, [row]);
  const gates = await approvalsForVersion(tx, brief.id, brief.version);
  const history = await approvalHistory(tx, brief.id);
  return {
    ...item!,
    claims: brief.claims,
    claimFlags: brief.claimFlags,
    gates: await toApprovals(tx, gates),
    history: await toApprovals(tx, history),
  };
}

export async function getApproval(actor: Actor, id: string): Promise<ApprovalDetail> {
  const { row, brief } = await readableApproval(db, actor, id);
  return buildApprovalDetail(db, actor, row, brief);
}

export async function decideApproval(
  actor: Actor,
  id: string,
  body: DecideApprovalRequest,
  ctx: AuditCtx,
): Promise<DecideApprovalResponse> {
  return db.transaction(async (tx) => {
    // Lock the brief first, then the approval, so two gate decisions never deadlock.
    const peek = await readableApproval(tx, actor, id);
    const brief = (await getBrief(tx, peek.brief.id, true))!;
    const [approval] = await tx
      .select()
      .from(approvals)
      .where(eq(approvals.id, id))
      .limit(1)
      .for('update');
    if (!approval) throw notFound('Approval');

    if (!isAssignedDecider(actor, approval)) {
      throw forbidden(
        approval.backupId === actor.id
          ? 'The backup can decide only after the gate has escalated.'
          : 'Only the named approver can decide this gate.',
        'GATE_NOT_ALLOWED',
      );
    }
    if (approval.decision !== 'pending') {
      throw conflict('This gate has already been decided.', 'ALREADY_DECIDED');
    }
    if (approval.version !== brief.version) {
      throw conflict(
        'This approval is for an older version of the brief and no longer counts.',
        'APPROVAL_STALE',
      );
    }
    if (brief.stage !== 'reviewed') {
      throw stageNotAllowed('This piece is not waiting for approval.');
    }

    const now = new Date();
    const note = body.note ? body.note : null;
    const [decided] = await tx
      .update(approvals)
      .set({
        decision: body.decision,
        note,
        decidedById: actor.id,
        decidedAt: now,
        updatedAt: now,
      })
      .where(and(eq(approvals.id, approval.id), eq(approvals.decision, 'pending')))
      .returning();
    if (!decided) throw conflict('This gate has already been decided.', 'ALREADY_DECIDED');

    let updatedBrief = brief;
    let postsCreated = 0;
    const gateText = `${GATE_LABEL[decided.gate]} gate`;

    if (body.decision === 'approved') {
      const gates = await approvalsForVersion(tx, brief.id, brief.version);
      const bothApproved = (['claims', 'brand'] as const).every((g) =>
        gates.some((a) => a.gate === g && a.decision === 'approved'),
      );
      if (bothApproved) {
        moveStage(brief.stage, 'approved');
        const [moved] = await tx
          .update(briefs)
          .set({ stage: 'approved', updatedAt: now })
          .where(eq(briefs.id, brief.id))
          .returning();
        updatedBrief = moved!;
        const created = await createDraftPostsForBrief(brief.id, actor.id, tx);
        postsCreated = created.length;
        await writeAudit(
          {
            ...ctx,
            action: 'brief.approve',
            entity: 'brief',
            entityId: brief.id,
            before: { stage: brief.stage, version: brief.version },
            after: { stage: 'approved', version: brief.version, postsCreated },
          },
          tx,
        );
      }
      if (brief.ownerId && brief.ownerId !== actor.id) {
        await createNotification(
          {
            userId: brief.ownerId,
            kind: 'approval_decided',
            title: bothApproved
              ? `${brief.code} is approved on both gates`
              : `${brief.code}: ${gateText} approved`,
            body: bothApproved ? 'Draft posts are ready on Publish.' : note,
            link: bothApproved ? `/publish/${brief.id}` : `/approvals?id=${decided.id}`,
            entity: 'brief',
            entityId: brief.id,
          },
          tx,
        );
      }
    } else {
      const others = (await approvalsForVersion(tx, brief.id, brief.version)).filter(
        (a) => a.id !== decided.id && a.decision === 'pending',
      );
      updatedBrief = await returnToBrief(tx, brief);
      await notifyMany(
        [brief.ownerId, ...others.map((a) => a.approverId)].filter((u) => u !== actor.id),
        {
          kind: 'approval_decided',
          title: `${brief.code}: changes requested on the ${gateText}`,
          body: note,
          link: `/briefs/${brief.id}`,
          entity: 'brief',
          entityId: brief.id,
        },
        tx,
      );
    }

    await writeAudit(
      {
        ...ctx,
        action: 'approval.decide',
        entity: 'approval',
        entityId: decided.id,
        before: { decision: approval.decision, version: approval.version, gate: approval.gate },
        after: {
          decision: decided.decision,
          note: decided.note,
          version: decided.version,
          gate: decided.gate,
          asBackup: decided.approverId !== actor.id,
          briefStage: updatedBrief.stage,
          briefVersion: updatedBrief.version,
        },
      },
      tx,
    );

    const refs = await toApprovals(tx, [decided]);
    return {
      approval: refs[0]!,
      brief: await toGateBrief(tx, updatedBrief),
      postsCreated,
    };
  });
}

/* ---------- Escalation (job approval.escalate) ---------- */

export interface EscalationResult {
  escalated: number;
  /** Past due but no backup: these wait for the approver. */
  waiting: number;
}

/**
 * Pending, current-version approvals past their due time get escalated once: the backup is
 * notified and may decide from then on. A gate without a backup waits. Safe to run again: an
 * approval is only escalated while `escalated_at` is still empty.
 */
export async function escalateDueApprovals(now = new Date()): Promise<EscalationResult> {
  const due = await db
    .select({ approval: approvals, brief: briefs })
    .from(approvals)
    .innerJoin(briefs, and(eq(briefs.id, approvals.briefId), eq(briefs.version, approvals.version)))
    .where(
      and(
        eq(approvals.decision, 'pending'),
        isNull(approvals.escalatedAt),
        lte(approvals.dueAt, now),
        eq(briefs.stage, 'reviewed'),
      ),
    )
    .orderBy(asc(approvals.dueAt))
    .limit(500);

  let escalated = 0;
  let waiting = 0;
  for (const { approval, brief } of due) {
    const done = await db.transaction(async (tx) => {
      let backupId = approval.backupId;
      if (!backupId) {
        // A backup may have been named after the request: look again before giving up.
        backupId = (await resolveAssignees(tx, brief))[approval.gate].backupId;
        if (backupId === approval.approverId) backupId = null;
      }
      if (!backupId) return 'waiting' as const;
      const [row] = await tx
        .update(approvals)
        .set({ escalatedAt: now, backupId, updatedAt: now })
        .where(
          and(
            eq(approvals.id, approval.id),
            eq(approvals.decision, 'pending'),
            isNull(approvals.escalatedAt),
          ),
        )
        .returning();
      if (!row) return 'skipped' as const;
      await createNotification(
        {
          userId: backupId,
          kind: 'approval_escalated',
          title: `${brief.code} needs your ${GATE_LABEL[row.gate]} approval (backup)`,
          body: `${brief.title}. No answer from the approver in time, so you can decide now.`,
          link: `/approvals?id=${row.id}`,
          entity: 'approval',
          entityId: row.id,
        },
        tx,
      );
      await writeAudit(
        {
          actorId: null,
          action: 'approval.escalate',
          entity: 'approval',
          entityId: row.id,
          before: { escalatedAt: null, backupId: approval.backupId },
          after: { escalatedAt: now, backupId },
        },
        tx,
      );
      return 'escalated' as const;
    });
    if (done === 'escalated') escalated += 1;
    if (done === 'waiting') waiting += 1;
  }
  if (escalated > 0 || waiting > 0) logger.info({ escalated, waiting }, 'approvals escalated');
  return { escalated, waiting };
}
