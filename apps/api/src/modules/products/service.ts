/**
 * Products, product kits and product members (PRODUCTS module).
 *
 * Rules kept here:
 * - `products.owner_id` / `backup_id` name the owner and backup. They always hold a matching
 *   `owner` / `backup` row in `product_members`, so route guards (requireProductRole) work.
 * - The current kit is the row with the highest version. Editing a signed kit writes a new
 *   version that is unsigned (draft) until the owner signs it again. Old versions are kept.
 * - The kit score (n of 10) is computed by `kitScore` from the contract and stored on write.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  kitFields,
  kitRefreshResultSchema,
  kitScore,
  PLATFORMS,
  type CreateProductRequest,
  type KitRefreshResult,
  type Platform,
  type ProductDetail,
  type ProductKitView,
  type ProductListQuery,
  type ProductListResponse,
  type ProductMember,
  type ProductRole,
  type ProductSummary,
  type PutProductMembersRequest,
  type SessionUser,
  type UpdateKitRequest,
  type UpdateProductRequest,
  type UserRef,
} from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db, type DbOrTx, type Tx } from '../../db/client.js';
import {
  auditLogs,
  briefs,
  channelAccounts,
  metricSnapshots,
  posts,
  productChannels,
  productKits,
  productMembers,
  productSettings,
  products,
  users,
} from '../../db/schema/index.js';
import { writeAudit, type AuditEntry } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../lib/errors.js';
import { notifyMany } from '../../lib/notifications.js';
import { toCount } from '../../lib/pagination.js';
import { iso, monthKey, zonedTimeToUtc } from '../../lib/time.js';
import { parseGithubRepo } from './github.js';

export type AuditCtx = Pick<AuditEntry, 'actorId' | 'requestId' | 'ip'>;

type ProductRow = typeof products.$inferSelect;
type KitRow = typeof productKits.$inferSelect;

/* ---------- Small helpers ---------- */

export async function userRefMap(ids: (string | null | undefined)[], tx: DbOrTx = db) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const map = new Map<string, UserRef>();
  if (unique.length === 0) return map;
  const rows = await tx
    .select({ id: users.id, name: users.name, initials: users.initials })
    .from(users)
    .where(inArray(users.id, unique));
  for (const r of rows) map.set(r.id, r);
  return map;
}

const refOf = (map: Map<string, UserRef>, id: string | null) => (id ? (map.get(id) ?? null) : null);

/** Current kit (highest version) per product. */
export async function currentKits(productIds: string[], tx: DbOrTx = db) {
  const map = new Map<string, KitRow>();
  if (productIds.length === 0) return map;
  const rows = await tx
    .selectDistinctOn([productKits.productId])
    .from(productKits)
    .where(inArray(productKits.productId, productIds))
    .orderBy(productKits.productId, desc(productKits.version));
  for (const r of rows) map.set(r.productId, r);
  return map;
}

/** Start and end of the current calendar month in the app zone, as instants and date keys. */
export function monthWindow(now: Date, tz: string = env.appTimezone) {
  const month = monthKey(now, tz);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return {
    from: zonedTimeToUtc(`${month}-01`, '00:00', tz),
    to: zonedTimeToUtc(`${next}-01`, '00:00', tz),
    fromKey: `${month}-01`,
    toKey: `${next}-01`,
  };
}

async function statsFor(productIds: string[], now: Date, tx: DbOrTx = db) {
  const stats = new Map<string, { piecesThisMonth: number; installsThisMonth: number }>();
  for (const id of productIds) stats.set(id, { piecesThisMonth: 0, installsThisMonth: 0 });
  if (productIds.length === 0) return stats;
  const w = monthWindow(now);
  const pieces = await tx
    .select({ productId: briefs.productId, n: sql<string>`count(*)` })
    .from(briefs)
    .where(
      and(
        inArray(briefs.productId, productIds),
        ne(briefs.stage, 'idea'),
        gte(briefs.createdAt, w.from),
        lt(briefs.createdAt, w.to),
      ),
    )
    .groupBy(briefs.productId);
  for (const r of pieces) stats.get(r.productId)!.piecesThisMonth = toCount(r.n);
  const installs = await tx
    .select({
      productId: briefs.productId,
      n: sql<string>`coalesce(sum(${metricSnapshots.installs}), 0)`,
    })
    .from(metricSnapshots)
    .innerJoin(posts, eq(posts.id, metricSnapshots.postId))
    .innerJoin(briefs, eq(briefs.id, posts.briefId))
    .where(
      and(
        inArray(briefs.productId, productIds),
        gte(metricSnapshots.date, w.fromKey),
        lt(metricSnapshots.date, w.toKey),
      ),
    )
    .groupBy(briefs.productId);
  for (const r of installs) stats.get(r.productId)!.installsThisMonth = toCount(r.n);
  return stats;
}

/** Platforms per product: enabled product channels; otherwise shared or own channel accounts. */
async function platformsFor(productIds: string[], tx: DbOrTx = db) {
  const result = new Map<string, Platform[]>();
  if (productIds.length === 0) return result;
  const linked = await tx
    .select({ productId: productChannels.productId, platform: channelAccounts.platform })
    .from(productChannels)
    .innerJoin(channelAccounts, eq(channelAccounts.id, productChannels.channelAccountId))
    .where(and(inArray(productChannels.productId, productIds), eq(productChannels.enabled, true)));
  const accounts = await tx
    .select({ productId: channelAccounts.productId, platform: channelAccounts.platform })
    .from(channelAccounts)
    .where(or(isNull(channelAccounts.productId), inArray(channelAccounts.productId, productIds)));
  const order = (list: Platform[]) => PLATFORMS.filter((p) => list.includes(p));
  for (const id of productIds) {
    const own = linked.filter((l) => l.productId === id).map((l) => l.platform);
    const fallback = accounts
      .filter((a) => a.productId === null || a.productId === id)
      .map((a) => a.platform);
    result.set(id, order(own.length > 0 ? own : fallback));
  }
  return result;
}

function scoreInputOf(
  kit: Pick<
    KitRow,
    | 'promise'
    | 'behaviours'
    | 'neverSay'
    | 'notBuilt'
    | 'audiences'
    | 'activationEvent'
    | 'truthSources'
  >,
  product: Pick<ProductRow, 'ownerId' | 'backupId'>,
) {
  return {
    promise: kit.promise,
    behaviours: kit.behaviours,
    neverSay: kit.neverSay,
    notBuilt: kit.notBuilt,
    audiences: kit.audiences,
    activationEvent: kit.activationEvent,
    truthSources: kit.truthSources,
    hasOwner: Boolean(product.ownerId),
    hasBackup: Boolean(product.backupId),
  };
}

async function buildSummaries(rows: ProductRow[], tx: DbOrTx = db): Promise<ProductSummary[]> {
  const ids = rows.map((r) => r.id);
  const [kits, stats, platforms] = await Promise.all([
    currentKits(ids, tx),
    statsFor(ids, new Date(), tx),
    platformsFor(ids, tx),
  ]);
  const refs = await userRefMap(
    [
      ...rows.flatMap((r) => [r.ownerId, r.backupId]),
      ...[...kits.values()].map((k) => k.signedById),
    ],
    tx,
  );
  return rows.map((p) => {
    const kit = kits.get(p.id);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      shortName: p.shortName,
      status: p.status,
      statusNote: p.statusNote,
      color: p.color,
      repoUrl: p.repoUrl,
      siteUrl: p.siteUrl,
      owner: refOf(refs, p.ownerId),
      backup: refOf(refs, p.backupId),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      kit: kit
        ? {
            version: kit.version,
            score: kitScore(scoreInputOf(kit, p)),
            promise: kit.promise,
            signedBy: refOf(refs, kit.signedById),
            signedAt: iso(kit.signedAt),
          }
        : null,
      stats: stats.get(p.id)!,
      platforms: platforms.get(p.id) ?? [],
    };
  });
}

async function membersOf(productId: string, tx: DbOrTx = db): Promise<ProductMember[]> {
  const rows = await tx
    .select({
      id: productMembers.id,
      productId: productMembers.productId,
      productRole: productMembers.productRole,
      createdAt: productMembers.createdAt,
      userId: users.id,
      name: users.name,
      initials: users.initials,
    })
    .from(productMembers)
    .innerJoin(users, eq(users.id, productMembers.userId))
    .where(eq(productMembers.productId, productId))
    .orderBy(asc(productMembers.productRole), asc(users.name));
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    productRole: r.productRole,
    createdAt: r.createdAt.toISOString(),
    user: { id: r.userId, name: r.name, initials: r.initials },
  }));
}

async function loadProduct(id: string, tx: DbOrTx = db, lock = false): Promise<ProductRow> {
  const q = tx.select().from(products).where(eq(products.id, id)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw notFound('Product');
  return row;
}

async function assertActiveUsers(ids: (string | null | undefined)[], tx: DbOrTx) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (unique.length === 0) return;
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, unique), eq(users.isActive, true)));
  if (rows.length !== unique.length) {
    throw badRequest('One of the people does not exist or is not active.', 'USER_NOT_FOUND');
  }
}

/* ---------- Products ---------- */

export async function listProducts(q: ProductListQuery): Promise<ProductListResponse> {
  const filters: SQL[] = [];
  if (q.status) filters.push(eq(products.status, q.status));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(or(ilike(products.name, like), ilike(products.slug, like))!);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(products)
      .where(where)
      .orderBy(
        sql`case ${products.status} when 'in_build' then 0 when 'live' then 1 when 'draft' then 2 else 3 end`,
        asc(products.name),
      )
      .limit(q.limit)
      .offset(q.offset),
    db
      .select({ n: sql<string>`count(*)` })
      .from(products)
      .where(where),
  ]);
  return { items: await buildSummaries(rows), total: toCount(count?.n) };
}

export async function getProductDetail(id: string, tx: DbOrTx = db): Promise<ProductDetail> {
  const row = await loadProduct(id, tx);
  const [summary] = await buildSummaries([row], tx);
  return { ...summary!, members: await membersOf(id, tx) };
}

async function setNamedRole(
  tx: Tx,
  productId: string,
  role: Extract<ProductRole, 'owner' | 'backup'>,
  oldUserId: string | null,
  newUserId: string | null,
) {
  if (oldUserId === newUserId) return;
  if (oldUserId) {
    await tx
      .delete(productMembers)
      .where(
        and(
          eq(productMembers.productId, productId),
          eq(productMembers.userId, oldUserId),
          eq(productMembers.productRole, role),
        ),
      );
  }
  if (newUserId) {
    await tx
      .insert(productMembers)
      .values({ productId, userId: newUserId, productRole: role })
      .onConflictDoNothing();
  }
}

export async function createProduct(
  input: CreateProductRequest,
  actor: SessionUser,
  ctx: AuditCtx,
): Promise<ProductDetail> {
  return db.transaction(async (tx) => {
    const [taken] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, input.slug))
      .limit(1);
    if (taken) throw conflict('Another product already uses this slug.', 'SLUG_TAKEN');
    await assertActiveUsers([input.ownerId, input.backupId], tx);

    const [row] = await tx
      .insert(products)
      .values({
        slug: input.slug,
        name: input.name,
        shortName: input.shortName ?? input.name.replace(/^Humini\s+/i, ''),
        status: input.status ?? 'draft',
        statusNote: input.statusNote ?? null,
        color: input.color?.toLowerCase() ?? null,
        repoUrl: input.repoUrl ?? null,
        siteUrl: input.siteUrl ?? null,
        ownerId: input.ownerId ?? null,
        backupId: input.backupId ?? null,
      })
      .returning();
    const product = row!;

    const truthSources = [product.repoUrl, product.siteUrl].filter((v): v is string => Boolean(v));
    const kitValues = {
      promise: null,
      behaviours: [],
      neverSay: [],
      notBuilt: [],
      audiences: [],
      activationEvent: null,
      truthSources,
    };
    await tx.insert(productKits).values({
      productId: product.id,
      version: 1,
      ...kitValues,
      score: kitScore(scoreInputOf(kitValues, product)),
    });

    await setNamedRole(tx, product.id, 'owner', null, product.ownerId);
    await setNamedRole(tx, product.id, 'backup', null, product.backupId);
    if (actor.role !== 'admin') {
      await tx
        .insert(productMembers)
        .values({ productId: product.id, userId: actor.id, productRole: 'maker' })
        .onConflictDoNothing();
    }

    const repo = parseGithubRepo(product.repoUrl);
    await tx
      .insert(productSettings)
      .values({
        productId: product.id,
        timezone: env.appTimezone,
        githubRepo: repo ? `${repo.owner}/${repo.name}` : null,
      })
      .onConflictDoNothing();

    await writeAudit(
      { ...ctx, action: 'product.create', entity: 'product', entityId: product.id, after: product },
      tx,
    );
    return getProductDetail(product.id, tx);
  });
}

export async function updateProduct(
  id: string,
  input: UpdateProductRequest,
  ctx: AuditCtx,
): Promise<ProductDetail> {
  return db.transaction(async (tx) => {
    const before = await loadProduct(id, tx, true);
    const next = {
      ownerId: input.ownerId === undefined ? before.ownerId : input.ownerId,
      backupId: input.backupId === undefined ? before.backupId : input.backupId,
    };
    if (next.ownerId && next.ownerId === next.backupId) {
      throw badRequest('Owner and backup must be different people.', 'VALIDATION_FAILED', [
        { path: 'body.backupId', message: 'Owner and backup must be different people' },
      ]);
    }
    await assertActiveUsers(
      [
        input.ownerId !== undefined && input.ownerId !== before.ownerId ? input.ownerId : null,
        input.backupId !== undefined && input.backupId !== before.backupId ? input.backupId : null,
      ],
      tx,
    );

    const patch: Partial<typeof products.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.shortName !== undefined) patch.shortName = input.shortName;
    if (input.status !== undefined) patch.status = input.status;
    if (input.statusNote !== undefined) patch.statusNote = input.statusNote;
    if (input.color !== undefined) patch.color = input.color?.toLowerCase() ?? null;
    if (input.repoUrl !== undefined) patch.repoUrl = input.repoUrl;
    if (input.siteUrl !== undefined) patch.siteUrl = input.siteUrl;
    if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
    if (input.backupId !== undefined) patch.backupId = input.backupId;

    const [after] = await tx.update(products).set(patch).where(eq(products.id, id)).returning();
    await setNamedRole(tx, id, 'owner', before.ownerId, after!.ownerId);
    await setNamedRole(tx, id, 'backup', before.backupId, after!.backupId);

    // Owner and backup are kit fields: keep the stored score true.
    const kit = (await currentKits([id], tx)).get(id);
    if (kit) {
      const score = kitScore(scoreInputOf(kit, after!));
      if (score !== kit.score) {
        await tx.update(productKits).set({ score }).where(eq(productKits.id, kit.id));
      }
    }

    await writeAudit(
      { ...ctx, action: 'product.update', entity: 'product', entityId: id, before, after },
      tx,
    );
    return getProductDetail(id, tx);
  });
}

export async function putMembers(
  id: string,
  input: PutProductMembersRequest,
  ctx: AuditCtx,
): Promise<ProductMember[]> {
  return db.transaction(async (tx) => {
    const product = await loadProduct(id, tx, true);
    const has = (userId: string | null, role: ProductRole) =>
      !userId || input.members.some((m) => m.userId === userId && m.productRole === role);
    if (!has(product.ownerId, 'owner')) {
      throw unprocessable(
        'The named owner must stay an owner. Change the owner first, then the members.',
        'OWNER_MEMBERSHIP_REQUIRED',
      );
    }
    if (!has(product.backupId, 'backup')) {
      throw unprocessable(
        'The named backup must stay a backup. Change the backup first, then the members.',
        'BACKUP_MEMBERSHIP_REQUIRED',
      );
    }
    await assertActiveUsers(
      input.members.map((m) => m.userId),
      tx,
    );
    const before = await membersOf(id, tx);
    await tx.delete(productMembers).where(eq(productMembers.productId, id));
    if (input.members.length > 0) {
      await tx.insert(productMembers).values(input.members.map((m) => ({ productId: id, ...m })));
    }
    const after = await membersOf(id, tx);
    await writeAudit(
      {
        ...ctx,
        action: 'product.members.replace',
        entity: 'product',
        entityId: id,
        before: before.map((m) => ({ userId: m.user.id, productRole: m.productRole })),
        after: after.map((m) => ({ userId: m.user.id, productRole: m.productRole })),
      },
      tx,
    );
    return after;
  });
}

/* ---------- Access helpers used by routes ---------- */

export async function productRolesOf(userId: string, productId: string, tx: DbOrTx = db) {
  const rows = await tx
    .select({ role: productMembers.productRole })
    .from(productMembers)
    .where(and(eq(productMembers.userId, userId), eq(productMembers.productId, productId)));
  return rows.map((r) => r.role);
}

/** Kit edit: admin or editor, or owner or backup of the product. */
export async function canEditKit(user: SessionUser, productId: string, tx: DbOrTx = db) {
  if (user.role === 'admin' || user.role === 'editor') return true;
  const roles = await productRolesOf(user.id, productId, tx);
  return roles.includes('owner') || roles.includes('backup');
}

/** Kit sign: the product owner only (named owner or an owner membership). Admin does not bypass. */
export async function canSignKit(user: SessionUser, product: ProductRow, tx: DbOrTx = db) {
  if (product.ownerId === user.id) return true;
  return (await productRolesOf(user.id, product.id, tx)).includes('owner');
}

/* ---------- Kit ---------- */

const KIT_REFRESH_ACTION = 'kit.refresh';

async function lastRefreshOf(productId: string, tx: DbOrTx = db): Promise<KitRefreshResult | null> {
  const [row] = await tx
    .select({ after: auditLogs.after })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, KIT_REFRESH_ACTION),
        eq(auditLogs.entity, 'product'),
        eq(auditLogs.entityId, productId),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = kitRefreshResultSchema.safeParse(row.after);
  return parsed.success ? parsed.data : null;
}

export async function getKitView(
  productId: string,
  user: SessionUser,
  tx: DbOrTx = db,
): Promise<ProductKitView> {
  const product = await loadProduct(productId, tx);
  const kit = (await currentKits([productId], tx)).get(productId);
  if (!kit) throw notFound('Product kit');
  const refs = await userRefMap([product.ownerId, product.backupId, kit.signedById], tx);
  const input = scoreInputOf(kit, product);
  const [canSign, canEdit, lastRefresh] = await Promise.all([
    canSignKit(user, product, tx),
    canEditKit(user, productId, tx),
    lastRefreshOf(productId, tx),
  ]);
  return {
    id: kit.id,
    productId,
    version: kit.version,
    promise: kit.promise,
    behaviours: kit.behaviours,
    neverSay: kit.neverSay,
    notBuilt: kit.notBuilt,
    audiences: kit.audiences,
    activationEvent: kit.activationEvent,
    truthSources: kit.truthSources,
    score: kitScore(input),
    signedBy: refOf(refs, kit.signedById),
    signedAt: iso(kit.signedAt),
    createdAt: kit.createdAt.toISOString(),
    updatedAt: kit.updatedAt.toISOString(),
    status: kit.signedAt ? 'signed' : 'draft',
    fields: kitFields(input),
    owner: refOf(refs, product.ownerId),
    backup: refOf(refs, product.backupId),
    canSign,
    canEdit,
    lastRefresh,
  };
}

type KitContent = Omit<UpdateKitRequest, 'version'>;

function kitContentOf(k: KitRow): KitContent {
  return {
    promise: k.promise,
    behaviours: k.behaviours,
    neverSay: k.neverSay,
    notBuilt: k.notBuilt,
    audiences: k.audiences,
    activationEvent: k.activationEvent,
    truthSources: k.truthSources,
  };
}

/** Stable compare of kit content (null spec refs and order count). */
export function sameKitContent(a: KitContent, b: KitContent): boolean {
  const norm = (k: KitContent) =>
    JSON.stringify({
      promise: k.promise ?? null,
      behaviours: k.behaviours.map((x) => ({ text: x.text, specRef: x.specRef ?? null })),
      neverSay: k.neverSay,
      notBuilt: k.notBuilt.map((x) => ({ text: x.text, specRef: x.specRef ?? null })),
      audiences: k.audiences,
      activationEvent: k.activationEvent ?? null,
      truthSources: k.truthSources,
    });
  return norm(a) === norm(b);
}

export async function updateKit(
  productId: string,
  input: UpdateKitRequest,
  user: SessionUser,
  ctx: AuditCtx,
): Promise<ProductKitView> {
  return db.transaction(async (tx) => {
    const product = await loadProduct(productId, tx, true);
    const current = (await currentKits([productId], tx)).get(productId);
    if (!current) throw notFound('Product kit');
    if (input.version !== current.version) {
      throw conflict(
        `The kit changed since you opened it (now version ${current.version}). Reload and try again.`,
        'KIT_VERSION_CONFLICT',
      );
    }
    const { version: _v, ...content } = input;
    if (sameKitContent(content, kitContentOf(current))) return getKitView(productId, user, tx);

    const score = kitScore(scoreInputOf(content, product));
    let after: KitRow;
    if (current.signedAt) {
      // A signed kit is never changed in place: the edit becomes a new draft version.
      const [row] = await tx
        .insert(productKits)
        .values({ productId, version: current.version + 1, ...content, score })
        .returning();
      after = row!;
      await notifyMany(
        [product.ownerId, product.backupId].filter((u) => u !== user.id),
        {
          kind: 'kit_changed',
          title: `${product.name} kit changed and needs a new signature`,
          body: `Version ${after.version} is a draft until the owner signs it.`,
          link: `/products/${productId}/kit`,
          entity: 'product',
          entityId: productId,
        },
        tx,
      );
    } else {
      const [row] = await tx
        .update(productKits)
        .set({ ...content, score })
        .where(eq(productKits.id, current.id))
        .returning();
      after = row!;
    }
    await writeAudit(
      {
        ...ctx,
        action: 'kit.update',
        entity: 'product_kit',
        entityId: after.id,
        before: current,
        after,
      },
      tx,
    );
    return getKitView(productId, user, tx);
  });
}

export async function signKit(
  productId: string,
  user: SessionUser,
  ctx: AuditCtx,
): Promise<ProductKitView> {
  return db.transaction(async (tx) => {
    const product = await loadProduct(productId, tx, true);
    if (!(await canSignKit(user, product, tx))) {
      throw forbidden('Only the product owner can sign the kit.', 'KIT_SIGN_NOT_ALLOWED');
    }
    const current = (await currentKits([productId], tx)).get(productId);
    if (!current) throw notFound('Product kit');
    if (current.signedAt) {
      throw conflict(`Version ${current.version} is already signed.`, 'KIT_ALREADY_SIGNED');
    }
    const [after] = await tx
      .update(productKits)
      .set({ signedById: user.id, signedAt: new Date() })
      .where(eq(productKits.id, current.id))
      .returning();
    await writeAudit(
      {
        ...ctx,
        action: 'kit.sign',
        entity: 'product_kit',
        entityId: current.id,
        before: { version: current.version, signedById: null, signedAt: null },
        after: {
          version: after!.version,
          signedById: after!.signedById,
          signedAt: after!.signedAt,
        },
      },
      tx,
    );
    return getKitView(productId, user, tx);
  });
}

/* ---------- Refresh bookkeeping (the GitHub part lives in kit-refresh.ts) ---------- */

export async function recordKitRefresh(
  productId: string,
  result: KitRefreshResult,
  ctx: AuditCtx,
  tx: DbOrTx = db,
): Promise<void> {
  await writeAudit(
    { ...ctx, action: KIT_REFRESH_ACTION, entity: 'product', entityId: productId, after: result },
    tx,
  );
}

export { loadProduct };
