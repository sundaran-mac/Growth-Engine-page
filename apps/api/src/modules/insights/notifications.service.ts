/**
 * The signed-in user's notifications (the top bar bell).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import type {
  Notification,
  NotificationListResponse,
  ReadAllNotificationsResponse,
} from '@growth-desk/contract';
import { db } from '../../db/client.js';
import { notifications } from '../../db/schema/index.js';
import { auditContext, writeAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { toCount } from '../../lib/pagination.js';
import { toNotification } from './mappers.js';

export async function listNotifications(
  userId: string,
  q: { unread?: boolean | undefined; limit: number; offset: number },
): Promise<NotificationListResponse> {
  const mine = eq(notifications.userId, userId);
  const cond = q.unread ? and(mine, isNull(notifications.readAt)) : mine;
  const rows = await db
    .select()
    .from(notifications)
    .where(cond)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(q.limit)
    .offset(q.offset);
  const [count] = await db
    .select({
      total: sql<string>`count(*)`.mapWith(toCount),
    })
    .from(notifications)
    .where(cond);
  const [unread] = await db
    .select({ n: sql<string>`count(*)`.mapWith(toCount) })
    .from(notifications)
    .where(and(mine, isNull(notifications.readAt)));
  return { items: rows.map(toNotification), total: count?.total ?? 0, unreadCount: unread?.n ?? 0 };
}

/** Marks one of the user's notifications read. Someone else's id is a 404 (no leak). */
export async function markNotificationRead(req: Request, id: string): Promise<Notification> {
  const userId = req.user!.id;
  const [existing] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  if (!existing) throw notFound('Notification');
  if (existing.readAt) return toNotification(existing);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    await writeAudit(
      { ...auditContext(req), action: 'notification.read', entity: 'notification', entityId: id },
      tx,
    );
    return toNotification(row!);
  });
}

export async function markAllNotificationsRead(
  req: Request,
): Promise<ReadAllNotificationsResponse> {
  const userId = req.user!.id;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    if (rows.length > 0) {
      await writeAudit(
        {
          ...auditContext(req),
          action: 'notification.read_all',
          entity: 'notification',
          after: { count: rows.length },
        },
        tx,
      );
    }
    return { updated: rows.length };
  });
}
