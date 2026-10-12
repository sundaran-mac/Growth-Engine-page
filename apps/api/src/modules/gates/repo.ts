/**
 * Database reads and row mapping for the gates module.
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type {
  Approval,
  ChecklistItem,
  GateBrief,
  ReviewComment,
  ReviewMasterAsset,
  UserRef,
} from '@growth-desk/contract';
import type { DbOrTx } from '../../db/client.js';
import {
  approvals,
  assets,
  briefs,
  posts,
  productMembers,
  products,
  reviewChecklists,
  reviewComments,
  users,
} from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import { getProductSettings } from '../settings/shared.js';
import type { ChecklistAsset, ChecklistInputs } from './checklist.js';

export type BriefRow = typeof briefs.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type CommentRow = typeof reviewComments.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

/** Used when SETTINGS has no answer yet (its stub throws NOT_IMPLEMENTED). */
export const DEFAULT_APPROVAL_SLA_HOURS = 24;

export interface GateSettings {
  approvalSlaHours: number;
  trackingBaseUrl: string | null;
}

export async function gateSettings(productId: string, tx: DbOrTx): Promise<GateSettings> {
  try {
    const s = await getProductSettings(productId, tx);
    return { approvalSlaHours: s.approvalSlaHours, trackingBaseUrl: s.trackingBaseUrl };
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_IMPLEMENTED') {
      return { approvalSlaHours: DEFAULT_APPROVAL_SLA_HOURS, trackingBaseUrl: null };
    }
    throw err;
  }
}

/* ---------- Users ---------- */

export async function loadUserRefs(
  tx: DbOrTx,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, UserRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name, initials: users.initials })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

const refOf = (refs: Map<string, UserRef>, id: string | null): UserRef | null =>
  id ? (refs.get(id) ?? null) : null;

/* ---------- Briefs ---------- */

export async function getBrief(tx: DbOrTx, id: string, lock = false): Promise<BriefRow | null> {
  const q = tx.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

export async function toGateBriefs(
  tx: DbOrTx,
  rows: readonly BriefRow[],
): Promise<Map<string, GateBrief>> {
  if (rows.length === 0) return new Map();
  const productIds = [...new Set(rows.map((b) => b.productId))];
  const prods = await tx
    .select({
      id: products.id,
      name: products.name,
      shortName: products.shortName,
      color: products.color,
    })
    .from(products)
    .where(inArray(products.id, productIds));
  const prodById = new Map(prods.map((p) => [p.id, p]));
  const refs = await loadUserRefs(
    tx,
    rows.map((b) => b.ownerId),
  );
  return new Map(
    rows.map((b) => {
      const p = prodById.get(b.productId);
      const brief: GateBrief = {
        id: b.id,
        code: b.code,
        title: b.title,
        kind: b.kind,
        mode: b.mode,
        stage: b.stage,
        version: b.version,
        hook: b.hook,
        captionLanguages: b.captionLanguages,
        productId: b.productId,
        productName: p?.name ?? '',
        productShortName: p?.shortName ?? '',
        productColor: p?.color ?? null,
        owner: refOf(refs, b.ownerId),
        updatedAt: b.updatedAt.toISOString(),
      };
      return [b.id, brief];
    }),
  );
}

export async function toGateBrief(tx: DbOrTx, row: BriefRow): Promise<GateBrief> {
  return (await toGateBriefs(tx, [row])).get(row.id)!;
}

/* ---------- Approvals ---------- */

export function toApproval(row: ApprovalRow, refs: Map<string, UserRef>): Approval {
  return {
    id: row.id,
    briefId: row.briefId,
    version: row.version,
    gate: row.gate,
    approver: refOf(refs, row.approverId),
    backup: refOf(refs, row.backupId),
    decidedBy: refOf(refs, row.decidedById),
    decision: row.decision,
    note: row.note,
    requestedAt: row.requestedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    escalatedAt: row.escalatedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function toApprovals(tx: DbOrTx, rows: readonly ApprovalRow[]): Promise<Approval[]> {
  const refs = await loadUserRefs(
    tx,
    rows.flatMap((r) => [r.approverId, r.backupId, r.decidedById]),
  );
  return rows.map((r) => toApproval(r, refs));
}

/** Gate order on screen: claims first, then brand. */
const gateOrder = sql`case ${approvals.gate} when 'claims' then 0 else 1 end`;

export async function approvalsForVersion(
  tx: DbOrTx,
  briefId: string,
  version: number,
): Promise<ApprovalRow[]> {
  return tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.briefId, briefId), eq(approvals.version, version)))
    .orderBy(gateOrder);
}

export async function approvalHistory(tx: DbOrTx, briefId: string): Promise<ApprovalRow[]> {
  return tx
    .select()
    .from(approvals)
    .where(eq(approvals.briefId, briefId))
    .orderBy(desc(approvals.version), gateOrder);
}

/* ---------- Gate assignees ---------- */

export interface GateAssignees {
  claims: { approverId: string | null; backupId: string | null };
  brand: { approverId: string | null; backupId: string | null };
}

async function activeUser(tx: DbOrTx, id: string | null) {
  if (!id) return null;
  const [u] = await tx
    .select({ id: users.id, isActive: users.isActive, isBrandApprover: users.isBrandApprover })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return u && u.isActive ? u : null;
}

async function firstMemberWithRole(
  tx: DbOrTx,
  productId: string,
  role: 'owner' | 'backup',
  exceptId: string | null,
): Promise<string | null> {
  const rows = await tx
    .select({ userId: productMembers.userId })
    .from(productMembers)
    .innerJoin(users, eq(users.id, productMembers.userId))
    .where(
      and(
        eq(productMembers.productId, productId),
        eq(productMembers.productRole, role),
        eq(users.isActive, true),
        exceptId ? ne(productMembers.userId, exceptId) : undefined,
      ),
    )
    .orderBy(asc(productMembers.createdAt), asc(users.name))
    .limit(1);
  return rows[0]?.userId ?? null;
}

async function brandApprovers(tx: DbOrTx): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isBrandApprover, true), eq(users.isActive, true)))
    .orderBy(asc(users.name), asc(users.id));
  return rows.map((r) => r.id);
}

/**
 * Claims gate: the brief's claims approver, else the product owner. Backup: the product backup.
 * Brand gate: the brief's brand approver (when still a brand approver), else the first brand
 * approver. Backup: another brand approver. A backup is never the approver; none means it waits.
 */
export async function resolveAssignees(tx: DbOrTx, brief: BriefRow): Promise<GateAssignees> {
  const [product] = await tx
    .select({ ownerId: products.ownerId, backupId: products.backupId })
    .from(products)
    .where(eq(products.id, brief.productId))
    .limit(1);

  const claimsApprover =
    (await activeUser(tx, brief.claimsApproverId))?.id ??
    (await activeUser(tx, product?.ownerId ?? null))?.id ??
    (await firstMemberWithRole(tx, brief.productId, 'owner', null));
  let claimsBackup =
    (await activeUser(tx, product?.backupId ?? null))?.id ??
    (await firstMemberWithRole(tx, brief.productId, 'backup', claimsApprover));
  if (claimsBackup === claimsApprover) claimsBackup = null;

  const named = await activeUser(tx, brief.brandApproverId);
  const all = await brandApprovers(tx);
  const brandApprover = named?.isBrandApprover ? named.id : (all[0] ?? null);
  const brandBackup = all.find((id) => id !== brandApprover) ?? null;

  return {
    claims: { approverId: claimsApprover ?? null, backupId: claimsBackup ?? null },
    brand: { approverId: brandApprover, backupId: brandBackup },
  };
}

/* ---------- Review checklist inputs ---------- */

const VISUAL_KINDS = ['video', 'poster', 'cutdown'] as const;

function toChecklistAsset(a: AssetRow): ChecklistAsset {
  return {
    mimeType: a.mimeType,
    licence: a.licence,
    consentOnFile: a.consentOnFile,
    aiGenerated: a.aiGenerated,
    // Entered in Studio (PATCH /assets/:id). Null keeps the loudness item a manual tick.
    loudnessLufs: a.loudnessLufs ?? null,
  };
}

/** The ready master: the brief's own kind first, current version first, newest first. */
export function pickMaster(brief: BriefRow, ready: readonly AssetRow[]): AssetRow | null {
  const preferred = brief.kind === 'poster' ? 'poster' : 'video';
  const candidates = ready.filter((a) => a.kind === 'video' || a.kind === 'poster');
  candidates.sort((a, b) => {
    const kind = Number(b.kind === preferred) - Number(a.kind === preferred);
    if (kind !== 0) return kind;
    const ver = Number(b.briefVersion === brief.version) - Number(a.briefVersion === brief.version);
    if (ver !== 0) return ver;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return candidates[0] ?? null;
}

export function toMasterAsset(a: AssetRow): ReviewMasterAsset {
  return {
    id: a.id,
    kind: a.kind,
    ratio: (a.ratio as ReviewMasterAsset['ratio']) ?? null,
    mimeType: a.mimeType,
    fileName: a.fileName,
    durationMs: a.durationMs,
    status: a.status,
  };
}

export interface ReviewData {
  inputs: ChecklistInputs;
  stored: { items: ChecklistItem[]; completedAt: Date | null } | null;
  master: AssetRow | null;
}

/** Everything the checklist needs, for many briefs at once. */
export async function loadReviewData(
  tx: DbOrTx,
  rows: readonly BriefRow[],
): Promise<Map<string, ReviewData>> {
  if (rows.length === 0) return new Map();
  const ids = rows.map((b) => b.id);
  // Sequential on purpose: `tx` may be one transaction client.
  const assetRows = await tx
    .select()
    .from(assets)
    .where(
      and(
        inArray(assets.briefId, ids),
        eq(assets.status, 'ready'),
        inArray(assets.kind, [...VISUAL_KINDS]),
      ),
    );
  const postRows = await tx
    .select({ briefId: posts.briefId, trackedUrl: posts.trackedUrl })
    .from(posts)
    .where(inArray(posts.briefId, ids));
  const checklistRows = await tx
    .select()
    .from(reviewChecklists)
    .where(inArray(reviewChecklists.briefId, ids));
  const settings = new Map<string, GateSettings>();
  for (const productId of new Set(rows.map((b) => b.productId))) {
    settings.set(productId, await gateSettings(productId, tx));
  }

  const out = new Map<string, ReviewData>();
  for (const b of rows) {
    const ready = assetRows.filter((a) => a.briefId === b.id);
    const master = pickMaster(b, ready);
    const stored = checklistRows.find((c) => c.briefId === b.id && c.version === b.version);
    out.set(b.id, {
      master,
      stored: stored ? { items: stored.items, completedAt: stored.completedAt } : null,
      inputs: {
        mode: b.mode,
        captionLanguages: b.captionLanguages,
        claimFlags: b.claimFlags,
        master: master ? toChecklistAsset(master) : null,
        visualAssets: ready.map(toChecklistAsset),
        posts: postRows.filter((p) => p.briefId === b.id),
        trackingBaseUrl: settings.get(b.productId)?.trackingBaseUrl ?? null,
      },
    });
  }
  return out;
}

/* ---------- Comments ---------- */

export async function toComments(
  tx: DbOrTx,
  rows: readonly CommentRow[],
): Promise<ReviewComment[]> {
  const refs = await loadUserRefs(
    tx,
    rows.map((r) => r.authorId),
  );
  return rows.map((r) => ({
    id: r.id,
    briefId: r.briefId,
    version: r.version,
    author: refOf(refs, r.authorId),
    authorLabel: r.authorLabel,
    timecodeMs: r.timecodeMs,
    parentId: r.parentId,
    body: r.body,
    resolved: r.resolved,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Open (unresolved) threads on each brief's current version. Replies do not add to the count. */
export async function openCommentCounts(
  tx: DbOrTx,
  rows: readonly BriefRow[],
): Promise<Map<string, number>> {
  if (rows.length === 0) return new Map();
  const counts = await tx
    .select({ briefId: reviewComments.briefId, n: sql<number>`count(*)::int` })
    .from(reviewComments)
    .innerJoin(
      briefs,
      and(eq(briefs.id, reviewComments.briefId), eq(briefs.version, reviewComments.version)),
    )
    .where(
      and(
        inArray(
          reviewComments.briefId,
          rows.map((b) => b.id),
        ),
        eq(reviewComments.resolved, false),
        isNull(reviewComments.parentId),
      ),
    )
    .groupBy(reviewComments.briefId);
  return new Map(counts.map((c) => [c.briefId, c.n]));
}
