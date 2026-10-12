/**
 * Who may read and change briefs, assets and render jobs.
 *
 * - read:  admin or editor (global), or any member of the product.
 * - write: admin or editor (global), or the product owner, backup or a maker.
 *          A global viewer never writes, whatever the product role.
 */
import type { Request } from 'express';
import type { Membership, SessionUser } from '@growth-desk/contract';
import { forbidden, unauthenticated } from '../../lib/errors.js';
import { getMemberships } from '../auth/service.js';

export type MakeAccessLevel = 'read' | 'write';

export function hasMakeAccess(
  user: Pick<SessionUser, 'role'>,
  memberships: readonly Membership[],
  productId: string,
  level: MakeAccessLevel,
): boolean {
  if (user.role === 'admin' || user.role === 'editor') return true;
  const roles = memberships.filter((m) => m.productId === productId).map((m) => m.productRole);
  if (level === 'read') return roles.length > 0;
  if (user.role === 'viewer') return false;
  return roles.some((r) => r === 'owner' || r === 'backup' || r === 'maker');
}

export interface Actor {
  user: SessionUser;
  memberships: Membership[];
  requestId: string | null;
  ip: string | null;
}

export async function actorOf(req: Request): Promise<Actor> {
  if (!req.user) throw unauthenticated();
  return {
    user: req.user,
    memberships: req.memberships ?? (await getMemberships(req.user.id)),
    requestId: req.id ? String(req.id) : null,
    ip: req.ip ?? null,
  };
}

export function assertMakeAccess(actor: Actor, productId: string, level: MakeAccessLevel): void {
  if (!hasMakeAccess(actor.user, actor.memberships, productId, level)) {
    throw forbidden(
      level === 'read'
        ? 'You are not on this product.'
        : 'Only the product owner, backup, a maker or an editor can change this.',
    );
  }
}

export const auditOf = (actor: Actor) => ({
  actorId: actor.user.id,
  requestId: actor.requestId,
  ip: actor.ip,
});
