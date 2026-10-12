/**
 * In-app notifications. Email delivery (SMTP) can be added later behind `env.features.smtp`.
 */
import type { NotificationKind } from '@growth-desk/contract';
import { db, type DbOrTx } from '../db/client.js';
import { notifications } from '../db/schema/index.js';

export interface NewNotification {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  /** In-app path, for example `/approvals` or `/review/<briefId>`. */
  link?: string | null;
  entity?: string | null;
  entityId?: string | null;
}

export async function createNotification(n: NewNotification, tx: DbOrTx = db): Promise<string> {
  const [row] = await tx
    .insert(notifications)
    .values({
      userId: n.userId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      entity: n.entity ?? null,
      entityId: n.entityId ?? null,
    })
    .returning({ id: notifications.id });
  return row!.id;
}

/** Same notification to many people (duplicates removed). */
export async function notifyMany(
  userIds: readonly (string | null | undefined)[],
  n: Omit<NewNotification, 'userId'>,
  tx: DbOrTx = db,
): Promise<number> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return 0;
  await tx.insert(notifications).values(
    ids.map((userId) => ({
      userId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      entity: n.entity ?? null,
      entityId: n.entityId ?? null,
    })),
  );
  return ids.length;
}
