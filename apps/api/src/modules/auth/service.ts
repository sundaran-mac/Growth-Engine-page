/**
 * Sessions and sign-in. A session is a random token in the `gd_session` cookie;
 * only its HMAC is stored. Expiry slides forward while the user is active.
 */
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Membership, MeResponse, SessionUser } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { productMembers, sessions, users } from '../../db/schema/index.js';
import { getDummyPasswordHash, hashToken, randomToken, verifyPassword } from '../../lib/crypto.js';
import { HOUR_MS } from '../../lib/time.js';

/** Do not write `last_seen_at` more often than this. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const sessionTtlMs = () => env.sessionTtlHours * HOUR_MS;

type UserRow = typeof users.$inferSelect;

export function toSessionUser(u: UserRow): SessionUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    initials: u.initials,
    title: u.title,
    role: u.role,
    isBrandApprover: u.isBrandApprover,
  };
}

export async function getMemberships(userId: string): Promise<Membership[]> {
  const rows = await db
    .select({ productId: productMembers.productId, productRole: productMembers.productRole })
    .from(productMembers)
    .where(eq(productMembers.userId, userId))
    .orderBy(productMembers.productId, productMembers.productRole);
  return rows;
}

export async function buildMe(user: SessionUser): Promise<MeResponse> {
  return { user, memberships: await getMemberships(user.id) };
}

/** Checks email and password. Same timing and same answer for unknown email and wrong password. */
export async function verifyCredentials(email: string, password: string): Promise<UserRow | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  if (!user) {
    await verifyPassword(await getDummyPasswordHash(), password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  return ok && user.isActive ? user : null;
}

export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  const [row] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    })
    .returning({ id: sessions.id });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  return { token, sessionId: row!.id, expiresAt };
}

export interface LoadedSession {
  sessionId: string;
  user: SessionUser;
  expiresAt: Date;
  /** True when expiry moved forward, so the cookie should be re-sent. */
  refreshed: boolean;
}

/** Finds a live session for the cookie token, sliding its expiry when due. */
export async function loadSession(token: string): Promise<LoadedSession | null> {
  if (!token || token.length > 200) return null;
  const now = new Date();
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row || !row.user.isActive) return null;

  let expiresAt = row.session.expiresAt;
  let refreshed = false;
  if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    expiresAt = new Date(now.getTime() + sessionTtlMs());
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt })
      .where(eq(sessions.id, row.session.id));
    refreshed = true;
  }
  return { sessionId: row.session.id, user: toSessionUser(row.user), expiresAt, refreshed };
}

export async function deleteSessionByToken(token: string): Promise<string | null> {
  const [row] = await db
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .returning({ userId: sessions.userId });
  return row?.userId ?? null;
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/** Removes expired sessions (worker cron). Returns how many were removed. */
export async function purgeExpiredSessions(): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return rows.length;
}
