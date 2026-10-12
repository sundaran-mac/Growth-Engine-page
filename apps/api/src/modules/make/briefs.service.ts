/**
 * Briefs: list, create, autosave with optimistic checks, claim check, freeze, send for review.
 */
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  isBriefEditable,
  masterAssetKinds,
  type Brief,
  type BriefKind,
  type BriefListQuery,
  type BriefListResponse,
  type BriefOptions,
  type ClaimCheckRequest,
  type ClaimCheckResult,
  type ContentMode,
  type Language,
  type Ratio,
  type UpdateBriefInput,
  type UserRef,
} from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import {
  assets,
  briefs,
  ideas,
  planItems,
  plans,
  productMembers,
  products,
  users,
} from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { nextBriefCode } from '../../lib/codes.js';
import { AppError, badRequest, notFound, unprocessable } from '../../lib/errors.js';
import { notifyMany } from '../../lib/notifications.js';
import { checkDuplicate, embeddingText, remember, withMemoryLock } from '../../lib/content-memory.js';
import { embedText } from '../../lib/embeddings.js';
import { guardRepeat } from '../memory/guard.js';
import { briefOwnSourceIds } from '../memory/service.js';
import { escapeLike } from './util.js';
import { assertMakeAccess, auditOf, type Actor } from './access.js';
import { runClaimCheck, type ClaimCheckBrief } from './claim-check.js';
import { findBrief, loadKit, toBriefView, toBriefViews, type BriefRow } from './repo.js';
import { transitionBriefStage, versionConflict } from './stage.js';

/* ---------- Defaults ---------- */

export function defaultKindForMode(mode: ContentMode): BriefKind {
  return mode === 'M4' ? 'poster' : 'reel';
}

export function defaultRatios(kind: BriefKind): Ratio[] {
  return kind === 'poster' || kind === 'carousel' || kind === 'post' ? ['4:5', '1:1'] : ['9:16', '4:5'];
}

const DEFAULT_LANGUAGES: Language[] = ['en'];

async function defaultApprovers(
  productId: string,
  tx: DbOrTx,
): Promise<{ claimsApproverId: string | null; brandApproverId: string | null }> {
  const [product] = await tx
    .select({ ownerId: products.ownerId })
    .from(products)
    .where(eq(products.id, productId));
  let claimsApproverId = product?.ownerId ?? null;
  if (!claimsApproverId) {
    const [owner] = await tx
      .select({ userId: productMembers.userId })
      .from(productMembers)
      .innerJoin(users, eq(users.id, productMembers.userId))
      .where(
        and(
          eq(productMembers.productId, productId),
          eq(productMembers.productRole, 'owner'),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(users.name))
      .limit(1);
    claimsApproverId = owner?.userId ?? null;
  }
  const [brand] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isBrandApprover, true), eq(users.isActive, true)))
    .orderBy(asc(users.name))
    .limit(1);
  return { claimsApproverId, brandApproverId: brand?.id ?? null };
}

/* ---------- Loading with access ---------- */

export async function loadBriefFor(
  actor: Actor,
  briefId: string,
  level: 'read' | 'write',
  tx: DbOrTx = db,
): Promise<BriefRow> {
  const row = await findBrief(briefId, tx);
  if (!row) throw notFound('Brief');
  assertMakeAccess(actor, row.productId, level);
  return row;
}

async function lockBrief(tx: DbOrTx, briefId: string): Promise<BriefRow> {
  const [row] = await tx.select().from(briefs).where(eq(briefs.id, briefId)).for('update');
  if (!row) throw notFound('Brief');
  return row;
}

/* ---------- List, get, options ---------- */

export async function listBriefs(actor: Actor, q: BriefListQuery): Promise<BriefListResponse> {
  assertMakeAccess(actor, q.productId, 'read');
  const conds = [eq(briefs.productId, q.productId)];
  if (q.stage && q.stage.length > 0) conds.push(inArray(briefs.stage, q.stage));
  if (q.q) {
    const pattern = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(briefs.title, pattern), ilike(briefs.code, pattern))!);
  }
  const where = and(...conds);
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(briefs)
      .where(where)
      .orderBy(desc(briefs.updatedAt), desc(briefs.code))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ n: count() }).from(briefs).where(where),
  ]);
  return { items: await toBriefViews(rows), total: Number(total?.n ?? 0) };
}

export async function getBrief(actor: Actor, briefId: string): Promise<Brief> {
  return toBriefView(await loadBriefFor(actor, briefId, 'read'));
}

async function memberRefs(productId: string, roles?: ('owner' | 'backup')[]): Promise<UserRef[]> {
  const rows = await db
    .selectDistinct({ id: users.id, name: users.name, initials: users.initials })
    .from(productMembers)
    .innerJoin(users, eq(users.id, productMembers.userId))
    .where(
      and(
        eq(productMembers.productId, productId),
        eq(users.isActive, true),
        roles ? inArray(productMembers.productRole, roles) : undefined,
      ),
    )
    .orderBy(asc(users.name));
  return rows;
}

async function claimsApproverIds(productId: string, tx: DbOrTx = db): Promise<Set<string>> {
  const [product] = await tx
    .select({ ownerId: products.ownerId, backupId: products.backupId })
    .from(products)
    .where(eq(products.id, productId));
  const members = await tx
    .select({ userId: productMembers.userId })
    .from(productMembers)
    .where(
      and(
        eq(productMembers.productId, productId),
        inArray(productMembers.productRole, ['owner', 'backup']),
      ),
    );
  return new Set(
    [product?.ownerId, product?.backupId, ...members.map((m) => m.userId)].filter(
      (id): id is string => Boolean(id),
    ),
  );
}

export async function getBriefOptions(actor: Actor, briefId: string): Promise<BriefOptions> {
  const brief = await loadBriefFor(actor, briefId, 'read');
  const ids = await claimsApproverIds(brief.productId);
  const [owners, approverRows, brandApprovers] = await Promise.all([
    memberRefs(brief.productId),
    ids.size
      ? db
          .select({ id: users.id, name: users.name, initials: users.initials })
          .from(users)
          .where(and(inArray(users.id, [...ids]), eq(users.isActive, true)))
          .orderBy(asc(users.name))
      : Promise.resolve([]),
    db
      .select({ id: users.id, name: users.name, initials: users.initials })
      .from(users)
      .where(and(eq(users.isBrandApprover, true), eq(users.isActive, true)))
      .orderBy(asc(users.name)),
  ]);
  return { owners, claimsApprovers: approverRows, brandApprovers };
}

/* ---------- Create ---------- */

interface NewBriefFields {
  productId: string;
  title: string;
  kind: BriefKind;
  mode: ContentMode;
  channels: Brief['channels'];
  ideaId?: string | null;
  hook?: string | null;
}

/** Inserts a brief in stage `brief` with a fresh code, default approvers and a first claim check. */
export async function insertBrief(
  tx: DbOrTx,
  fields: NewBriefFields,
  actorId: string,
): Promise<BriefRow> {
  const code = await nextBriefCode(fields.kind, tx);
  const approvers = await defaultApprovers(fields.productId, tx);
  const kit = await loadKit(fields.productId, tx);
  const hook = fields.hook?.trim() ? fields.hook.trim() : null;
  const check = runClaimCheck({ hook, beats: [], ask: null }, kit);
  const now = new Date();
  const [row] = await tx
    .insert(briefs)
    .values({
      code,
      kind: fields.kind,
      productId: fields.productId,
      ideaId: fields.ideaId ?? null,
      title: fields.title,
      mode: fields.mode,
      stage: 'brief',
      hook,
      ratios: defaultRatios(fields.kind),
      captionLanguages: DEFAULT_LANGUAGES,
      channels: fields.channels,
      ownerId: actorId,
      ...approvers,
      claimFlags: check.flags,
      claims: check.claims,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row!;
}

/**
 * Manual brief (no idea). Title and hook are checked against the content memory of every
 * product under the memory lock: a duplicate is refused (409 IDEA_DUPLICATE), a similar one
 * needs `similarReason` (409 IDEA_SIMILAR). The brief is remembered as a `brief_hook` row.
 */
export async function createBrief(
  actor: Actor,
  input: {
    productId: string;
    title: string;
    kind: BriefKind;
    mode: ContentMode;
    channels: Brief['channels'];
    hook?: string | null | undefined;
    similarReason?: string | undefined;
  },
): Promise<Brief> {
  assertMakeAccess(actor, input.productId, 'write');
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) throw notFound('Product');
  const hook = input.hook?.trim() ? input.hook.trim() : null;
  const embedding = await embedText(embeddingText('brief_hook', input.title, hook));
  const row = await db.transaction((tx) =>
    withMemoryLock(tx, async () => {
      const check = await checkDuplicate(
        { kind: 'brief_hook', title: input.title, body: hook, productId: input.productId, embedding },
        tx,
      );
      const decision = guardRepeat(check, { field: hook ? 'body.hook' : 'body.title', similarReason: input.similarReason });
      const created = await insertBrief(
        tx,
        { productId: input.productId, title: input.title, kind: input.kind, mode: input.mode, channels: input.channels, hook },
        actor.user.id,
      );
      await remember(
        { sourceType: 'brief_hook', sourceId: created.id, productId: created.productId, title: created.title, body: hook, mode: created.mode, embedding },
        tx,
      );
      await writeAudit(
        { ...auditOf(actor), action: 'brief.create', entity: 'brief', entityId: created.id, after: { ...created, memory: decision } },
        tx,
      );
      return created;
    }),
  );
  return toBriefView(row);
}

/** Body of the `createBriefFromIdea` shared function (see shared.ts). */
export async function createBriefFromIdeaTx(
  tx: DbOrTx,
  input: { ideaId: string; actorId: string; planItemId?: string },
): Promise<BriefRow> {
  const [idea] = await tx.select().from(ideas).where(eq(ideas.id, input.ideaId)).for('update');
  if (!idea) throw notFound('Idea');

  const [existing] = await tx.select().from(briefs).where(eq(briefs.ideaId, idea.id)).limit(1);
  let brief: BriefRow;
  if (existing) {
    brief = existing;
  } else {
    if (idea.status === 'parked') {
      throw unprocessable('Unpark the idea before you open it as a brief.', 'IDEA_PARKED');
    }
    const kind = defaultKindForMode(idea.mode);
    brief = await insertBrief(
      tx,
      {
        productId: idea.productId,
        title: idea.title,
        kind,
        mode: idea.mode,
        channels: idea.channels,
        ideaId: idea.id,
      },
      input.actorId,
    );
    await writeAudit(
      {
        actorId: input.actorId,
        action: 'brief.create_from_idea',
        entity: 'brief',
        entityId: brief.id,
        after: { ...brief, ideaId: idea.id },
      },
      tx,
    );
  }

  if (idea.status !== 'briefed') {
    await tx.update(ideas).set({ status: 'briefed' }).where(eq(ideas.id, idea.id));
    await writeAudit(
      {
        actorId: input.actorId,
        action: 'idea.briefed',
        entity: 'idea',
        entityId: idea.id,
        before: { status: idea.status },
        after: { status: 'briefed', briefId: brief.id },
      },
      tx,
    );
  }

  if (input.planItemId) {
    const [item] = await tx
      .select({ id: planItems.id, briefId: planItems.briefId, productId: plans.productId })
      .from(planItems)
      .innerJoin(plans, eq(plans.id, planItems.planId))
      .where(eq(planItems.id, input.planItemId));
    if (!item) throw notFound('Plan item');
    if (item.productId !== brief.productId) {
      throw badRequest('The plan item belongs to another product.');
    }
    if (item.briefId !== brief.id) {
      await tx.update(planItems).set({ briefId: brief.id }).where(eq(planItems.id, item.id));
      await writeAudit(
        {
          actorId: input.actorId,
          action: 'plan_item.link_brief',
          entity: 'plan_item',
          entityId: item.id,
          before: { briefId: item.briefId },
          after: { briefId: brief.id },
        },
        tx,
      );
    }
  }
  return brief;
}

/* ---------- Autosave ---------- */

const CONTENT_FIELDS = [
  'title',
  'mode',
  'hook',
  'beats',
  'ask',
  'ratios',
  'captionLanguages',
  'channels',
  'ownerId',
  'claimsApproverId',
  'brandApproverId',
  'claudeSuggestions',
] as const;

type Patch = Omit<UpdateBriefInput, 'version' | 'updatedAt'>;

function cleanBeats(beats: readonly string[]): string[] {
  return beats.map((b) => b.trim());
}

async function assertPeople(tx: DbOrTx, brief: BriefRow, patch: Patch): Promise<void> {
  if (patch.ownerId) {
    const [m] = await tx
      .select({ id: productMembers.id })
      .from(productMembers)
      .innerJoin(users, eq(users.id, productMembers.userId))
      .where(
        and(
          eq(productMembers.productId, brief.productId),
          eq(productMembers.userId, patch.ownerId),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    if (!m) throw unprocessable('The owner must be an active member of this product.', 'INVALID_OWNER');
  }
  if (patch.claimsApproverId) {
    const ids = await claimsApproverIds(brief.productId, tx);
    if (!ids.has(patch.claimsApproverId)) {
      throw unprocessable(
        'The claims approver must be the product owner or backup.',
        'INVALID_APPROVER',
      );
    }
  }
  if (patch.brandApproverId) {
    const [u] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, patch.brandApproverId),
          eq(users.isBrandApprover, true),
          eq(users.isActive, true),
        ),
      );
    if (!u) throw unprocessable('The brand approver must be a brand approver.', 'INVALID_APPROVER');
  }
}

export async function updateBrief(
  actor: Actor,
  briefId: string,
  input: UpdateBriefInput,
): Promise<Brief> {
  // The embedding is fetched before the transaction (a network call must not hold row locks).
  const memoryEmbedding = await hookEmbeddingFor(briefId, input);
  const row = await db.transaction(async (tx) => {
    const current = await loadBriefFor(actor, briefId, 'write', tx);
    if (!isBriefEditable(current.stage)) {
      throw unprocessable(
        'This brief is frozen. Unfreeze it, or send it back from review, to change it.',
        'STAGE_NOT_ALLOWED',
      );
    }
    const { version, updatedAt, ...patch } = input;
    await assertPeople(tx, current, patch);

    const set: Partial<typeof briefs.$inferInsert> = {};
    if (patch.title !== undefined) set.title = patch.title;
    if (patch.mode !== undefined) set.mode = patch.mode;
    if (patch.hook !== undefined) set.hook = patch.hook?.trim() ? patch.hook.trim() : null;
    if (patch.beats !== undefined) set.beats = cleanBeats(patch.beats);
    if (patch.ask !== undefined) set.ask = patch.ask?.trim() ? patch.ask.trim() : null;
    if (patch.ratios !== undefined) set.ratios = [...new Set(patch.ratios)];
    if (patch.captionLanguages !== undefined) set.captionLanguages = [...new Set(patch.captionLanguages)];
    if (patch.channels !== undefined) set.channels = [...new Set(patch.channels)];
    if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
    if (patch.claimsApproverId !== undefined) set.claimsApproverId = patch.claimsApproverId;
    if (patch.brandApproverId !== undefined) set.brandApproverId = patch.brandApproverId;
    if (patch.claudeSuggestions !== undefined) {
      set.claudeSuggestions = {
        captions: patch.claudeSuggestions.captions ?? [],
        altHooks: patch.claudeSuggestions.altHooks ?? [],
        bRoll: patch.claudeSuggestions.bRoll ?? [],
        generatedAt: patch.claudeSuggestions.generatedAt ?? null,
      };
    }

    const next: ClaimCheckBrief = {
      hook: set.hook !== undefined ? set.hook : current.hook,
      beats: set.beats ?? current.beats,
      ask: set.ask !== undefined ? set.ask : current.ask,
    };
    const check = runClaimCheck(next, await loadKit(current.productId, tx));
    set.claimFlags = check.flags;
    set.claims = check.claims;
    set.updatedAt = new Date();

    // Optimistic check: same version and the same save the editor loaded (millisecond precision).
    const [updated] = await tx
      .update(briefs)
      .set(set)
      .where(
        and(
          eq(briefs.id, briefId),
          eq(briefs.version, version),
          sql`abs(extract(epoch from ${briefs.updatedAt}) - extract(epoch from ${updatedAt}::timestamptz)) < 0.001`,
        ),
      )
      .returning();
    if (!updated) throw versionConflict();
    const memory = await rememberHook(tx, current, updated, memoryEmbedding);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of CONTENT_FIELDS) {
      if (patch[k] === undefined) continue;
      before[k] = current[k];
      after[k] = updated[k];
    }
    if (memory) after.memory = memory;
    await writeAudit(
      { ...auditOf(actor), action: 'brief.update', entity: 'brief', entityId: briefId, before, after },
      tx,
    );
    return updated;
  });
  return toBriefView(row);
}

/* ---------- Content memory for hooks ---------- */

interface HookEmbedding {
  text: string;
  embedding: number[] | null;
}

/** Embedding of the hook this save would write, or null when the hook does not change. */
async function hookEmbeddingFor(briefId: string, input: UpdateBriefInput): Promise<HookEmbedding | null> {
  if (input.hook === undefined && input.title === undefined) return null;
  const [cur] = await db.select({ title: briefs.title, hook: briefs.hook }).from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!cur) return null;
  const title = input.title ?? cur.title;
  const hook = input.hook !== undefined ? (input.hook?.trim() ? input.hook.trim() : null) : cur.hook;
  if (!hook) return null;
  const text = embeddingText('brief_hook', title, hook);
  return { text, embedding: await embedText(text) };
}

/**
 * When a save changes the hook (or the title of a brief with a hook): blocks a hook that
 * duplicates ANOTHER brief's hook (409 IDEA_DUPLICATE); "similar" only warns (the editor asks
 * POST /memory/check). Then the brief's memory row is updated. Clearing the hook keeps the
 * last remembered one.
 */
async function rememberHook(
  tx: DbOrTx,
  current: BriefRow,
  updated: BriefRow,
  pre: HookEmbedding | null,
): Promise<{ status: string; matchIds: string[] } | null> {
  const hook = updated.hook?.trim() ? updated.hook : null;
  const changed = updated.hook !== current.hook || (hook !== null && updated.title !== current.title);
  if (!changed || !hook) return null;
  const text = embeddingText('brief_hook', updated.title, hook);
  const embedding = pre && pre.text === text ? pre.embedding : null;
  return withMemoryLock(tx, async () => {
    const own = await briefOwnSourceIds(updated.id, tx);
    const check = await checkDuplicate(
      { kind: 'brief_hook', title: updated.title, body: hook, productId: updated.productId, excludeSourceIds: own, embedding },
      tx,
    );
    const blocking = check.matches.filter((m) => m.level === 'duplicate' && m.sourceType === 'brief_hook');
    if (blocking.length > 0) guardRepeat({ status: 'duplicate', matches: blocking }, { field: 'body.hook' });
    await remember(
      { sourceType: 'brief_hook', sourceId: updated.id, productId: updated.productId, title: updated.title, body: hook, mode: updated.mode, embedding },
      tx,
    );
    return { status: check.status, matchIds: check.matches.map((m) => m.id) };
  });
}

/* ---------- Claim check ---------- */

export async function claimCheckBrief(
  actor: Actor,
  briefId: string,
  body: ClaimCheckRequest,
): Promise<ClaimCheckResult> {
  const brief = await loadBriefFor(actor, briefId, body.draft ? 'read' : 'write');
  const kit = await loadKit(brief.productId);
  const subject: ClaimCheckBrief = {
    hook: body.draft?.hook !== undefined ? body.draft.hook : brief.hook,
    beats: body.draft?.beats ?? brief.beats,
    ask: body.draft?.ask !== undefined ? body.draft.ask : brief.ask,
  };
  const out = runClaimCheck(subject, kit);
  let stored = false;
  // Without a draft the stored text was checked: save the result (updatedAt stays, so an
  // open editor does not get a version conflict).
  if (!body.draft) {
    await db.transaction(async (tx) => {
      await tx
        .update(briefs)
        .set({ claimFlags: out.flags, claims: out.claims, updatedAt: brief.updatedAt })
        .where(eq(briefs.id, brief.id));
      await writeAudit(
        {
          ...auditOf(actor),
          action: 'brief.claim_check',
          entity: 'brief',
          entityId: brief.id,
          before: { claimFlags: brief.claimFlags, claims: brief.claims },
          after: { claimFlags: out.flags, claims: out.claims },
        },
        tx,
      );
    });
    stored = true;
  }
  return {
    ...out,
    kitVersion: kit?.version ?? null,
    stored,
    checkedAt: new Date().toISOString(),
  };
}

/* ---------- Freeze, unfreeze, send for review ---------- */

export async function freezeBrief(actor: Actor, briefId: string, version: number): Promise<Brief> {
  const row = await db.transaction(async (tx) => {
    await loadBriefFor(actor, briefId, 'write', tx);
    const brief = await lockBrief(tx, briefId);
    if (brief.version !== version) throw versionConflict();
    if (brief.stage !== 'brief') {
      throw unprocessable('Only a brief in the Brief stage can be frozen.', 'STAGE_NOT_ALLOWED');
    }
    if (!brief.hook?.trim() || !brief.beats.some((b) => b.trim())) {
      throw unprocessable('Write the hook and at least one beat before you freeze.', 'BRIEF_INCOMPLETE');
    }
    const check = runClaimCheck(brief, await loadKit(brief.productId, tx));
    if (check.blocking) {
      throw new AppError({
        status: 422,
        code: 'CLAIM_CHECK_FAILED',
        title: 'Claim check has red flags',
        detail: 'Fix the red flags in the claim check, then freeze.',
      });
    }
    return transitionBriefStage(tx, brief, 'frozen', {
      expectedVersion: version,
      set: { frozenAt: new Date(), claimFlags: check.flags, claims: check.claims },
      audit: auditOf(actor),
      action: 'brief.freeze',
    });
  });
  return toBriefView(row);
}

export async function unfreezeBrief(actor: Actor, briefId: string, version: number): Promise<Brief> {
  const row = await db.transaction(async (tx) => {
    await loadBriefFor(actor, briefId, 'write', tx);
    const brief = await lockBrief(tx, briefId);
    if (brief.stage !== 'frozen') {
      throw unprocessable('Only a frozen brief can be unfrozen.', 'STAGE_NOT_ALLOWED');
    }
    return transitionBriefStage(tx, brief, 'brief', {
      expectedVersion: version,
      set: { frozenAt: null },
      audit: auditOf(actor),
      action: 'brief.unfreeze',
    });
  });
  return toBriefView(row);
}

export async function sendForReview(actor: Actor, briefId: string, version: number): Promise<Brief> {
  const row = await db.transaction(async (tx) => {
    await loadBriefFor(actor, briefId, 'write', tx);
    const brief = await lockBrief(tx, briefId);
    if (brief.stage !== 'frozen') {
      throw unprocessable('Only a frozen brief can be sent for review.', 'STAGE_NOT_ALLOWED');
    }
    if (brief.version !== version) throw versionConflict();
    const [master] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(
          eq(assets.briefId, brief.id),
          eq(assets.status, 'ready'),
          eq(assets.briefVersion, brief.version),
          inArray(assets.kind, [...masterAssetKinds(brief.kind)]),
        ),
      )
      .limit(1);
    if (!master) {
      throw unprocessable(
        'Upload the finished master file first. It must be ready before review.',
        'MASTER_ASSET_MISSING',
      );
    }
    const moved = await transitionBriefStage(tx, brief, 'made', {
      expectedVersion: version,
      audit: auditOf(actor),
      action: 'brief.send_for_review',
    });
    const reviewers = await tx
      .select({ userId: productMembers.userId })
      .from(productMembers)
      .where(
        and(eq(productMembers.productId, brief.productId), eq(productMembers.productRole, 'reviewer')),
      );
    await notifyMany(
      [...reviewers.map((r) => r.userId), brief.ownerId].filter((id) => id !== actor.user.id),
      {
        kind: 'system',
        title: `${brief.code} is ready for review`,
        body: brief.title,
        link: `/review/${brief.id}`,
        entity: 'brief',
        entityId: brief.id,
      },
      tx,
    );
    return moved;
  });
  return toBriefView(row);
}
