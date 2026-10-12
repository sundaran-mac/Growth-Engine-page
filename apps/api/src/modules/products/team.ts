/**
 * Team and roles (Integrations screen): list people, invite a person (admin), change a person.
 * Temp passwords are shown once and stored only as an argon2id hash.
 */
import { and, asc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type {
  CreateUserRequest,
  SessionUser,
  TeamListQuery,
  TeamListResponse,
  TeamMember,
  UpdateUserRequest,
} from '@growth-desk/contract';
import { db, type DbOrTx } from '../../db/client.js';
import { productMembers, products, users } from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { hashPassword, randomToken } from '../../lib/crypto.js';
import { conflict, notFound, unprocessable } from '../../lib/errors.js';
import { toCount } from '../../lib/pagination.js';
import { iso } from '../../lib/time.js';
import { deleteSessionsForUser } from '../auth/service.js';
import type { AuditCtx } from './service.js';

type UserRow = typeof users.$inferSelect;

/** Initials from a name: "Jeeva Santiago" -> "JS", "Elan" -> "E". */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]![0]}${parts[parts.length - 1]![0]}` : (parts[0]?.[0] ?? 'U');
  return letters.toUpperCase().slice(0, 2);
}

/** Readable temp password, 20 characters from a 15 byte random value. */
export function newTempPassword(): string {
  return randomToken(15);
}

async function buildTeam(rows: UserRow[], tx: DbOrTx = db): Promise<TeamMember[]> {
  const ids = rows.map((r) => r.id);
  const memberships =
    ids.length === 0
      ? []
      : await tx
          .select({
            userId: productMembers.userId,
            productId: products.id,
            productName: products.name,
            productRole: productMembers.productRole,
          })
          .from(productMembers)
          .innerJoin(products, eq(products.id, productMembers.productId))
          .where(inArray(productMembers.userId, ids))
          .orderBy(asc(products.name), asc(productMembers.productRole));
  const backups =
    ids.length === 0
      ? []
      : await tx
          .select({ userId: products.backupId, productId: products.id, productName: products.name })
          .from(products)
          .where(inArray(products.backupId, ids))
          .orderBy(asc(products.name));
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    initials: u.initials,
    title: u.title,
    role: u.role,
    isBrandApprover: u.isBrandApprover,
    isActive: u.isActive,
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    memberships: memberships
      .filter((m) => m.userId === u.id)
      .map(({ productId, productName, productRole }) => ({ productId, productName, productRole })),
    backupFor: backups
      .filter((b) => b.userId === u.id)
      .map(({ productId, productName }) => ({ productId, productName })),
  }));
}

export async function listTeam(q: TeamListQuery): Promise<TeamListResponse> {
  const filters: SQL[] = [];
  if (!q.includeInactive) filters.push(eq(users.isActive, true));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    filters.push(or(ilike(users.name, like), ilike(users.email, like))!);
  }
  const where = filters.length > 0 ? and(...filters) : undefined;
  const [rows, [count]] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.name)).limit(q.limit).offset(q.offset),
    db
      .select({ n: sql<string>`count(*)` })
      .from(users)
      .where(where),
  ]);
  return { items: await buildTeam(rows), total: toCount(count?.n) };
}

export async function createUser(
  input: CreateUserRequest,
  ctx: AuditCtx,
): Promise<{ user: TeamMember; tempPassword: string }> {
  const email = input.email.trim().toLowerCase();
  const tempPassword = newTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  return db.transaction(async (tx) => {
    const [exists] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (exists) throw conflict('A person with this email already exists.', 'EMAIL_TAKEN');
    const [row] = await tx
      .insert(users)
      .values({
        email,
        name: input.name.trim(),
        initials: initialsFrom(input.name),
        title: input.title ?? null,
        role: input.role ?? 'member',
        isBrandApprover: input.isBrandApprover ?? false,
        passwordHash,
      })
      .returning();
    await writeAudit(
      { ...ctx, action: 'user.create', entity: 'user', entityId: row!.id, after: row },
      tx,
    );
    const [user] = await buildTeam([row!], tx);
    return { user: user!, tempPassword };
  });
}

export async function updateUser(
  id: string,
  input: UpdateUserRequest,
  actor: SessionUser,
  ctx: AuditCtx,
): Promise<TeamMember> {
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, id)).limit(1).for('update');
    if (!before) throw notFound('Person');

    const losesAdmin =
      before.role === 'admin' &&
      ((input.role !== undefined && input.role !== 'admin') || input.isActive === false);
    if (id === actor.id && losesAdmin) {
      throw unprocessable(
        'You cannot remove your own admin role or turn yourself off. Ask another admin.',
        'CANNOT_CHANGE_SELF',
      );
    }
    if (losesAdmin) {
      const [others] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isActive, true), ne(users.id, id)));
      if (toCount(others?.n) === 0) {
        throw unprocessable('Growth Desk needs at least one active admin.', 'LAST_ADMIN');
      }
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.name !== undefined) {
      patch.name = input.name;
      patch.initials = initialsFrom(input.name);
    }
    if (input.title !== undefined) patch.title = input.title;
    if (input.role !== undefined) patch.role = input.role;
    if (input.isBrandApprover !== undefined) patch.isBrandApprover = input.isBrandApprover;
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    const [after] = await tx.update(users).set(patch).where(eq(users.id, id)).returning();
    await writeAudit(
      { ...ctx, action: 'user.update', entity: 'user', entityId: id, before, after },
      tx,
    );
    const [member] = await buildTeam([after!], tx);
    return { member: member!, deactivated: before.isActive && after!.isActive === false };
  });
  // A person turned off is signed out everywhere.
  if (result.deactivated) await deleteSessionsForUser(id);
  return result.member;
}
