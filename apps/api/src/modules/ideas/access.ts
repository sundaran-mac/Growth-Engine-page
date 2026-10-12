/**
 * Who may do what on the Ideas board and the Plan (RACI from spec section 2.2).
 *
 * | Action | Allowed |
 * |---|---|
 * | read   | admin, editor, viewer; or any member of the product |
 * | write  | admin, editor; or product owner, backup, maker (ideas, plan items, generate) |
 * | delete | admin, editor (delete an idea) |
 * | freeze | admin, editor; or product owner |
 * | unfreeze | admin only |
 */
import type { Request, RequestHandler } from 'express';
import type { Membership, ProductRole, Role, SessionUser } from '@growth-desk/contract';
import { badRequest, forbidden, unauthenticated } from '../../lib/errors.js';
import { getMemberships } from '../auth/service.js';

export type IdeasAction = 'read' | 'write' | 'delete' | 'freeze' | 'unfreeze';

interface Rule {
  roles: readonly Role[];
  productRoles: readonly ProductRole[] | 'any';
}

const RULES: Record<IdeasAction, Rule> = {
  read: { roles: ['admin', 'editor', 'viewer'], productRoles: 'any' },
  write: { roles: ['admin', 'editor'], productRoles: ['owner', 'backup', 'maker'] },
  delete: { roles: ['admin', 'editor'], productRoles: [] },
  freeze: { roles: ['admin', 'editor'], productRoles: ['owner'] },
  unfreeze: { roles: ['admin'], productRoles: [] },
};

/** Pure check, unit tested. */
export function canDo(
  user: Pick<SessionUser, 'role'>,
  memberships: readonly Membership[],
  productId: string,
  action: IdeasAction,
): boolean {
  const rule = RULES[action];
  if (user.role === 'admin' || rule.roles.includes(user.role)) return true;
  const mine = memberships.filter((m) => m.productId === productId);
  if (rule.productRoles === 'any') return mine.length > 0;
  const allowed = rule.productRoles;
  return mine.some((m) => allowed.includes(m.productRole));
}

const DENIED: Record<IdeasAction, string> = {
  read: 'You are not a member of this product.',
  write: 'You need to be an editor, or the owner, backup or maker of this product.',
  delete: 'Only an editor or admin can delete an idea.',
  freeze: 'Only an editor or the product owner can freeze the plan.',
  unfreeze: 'Only an admin can unfreeze a plan.',
};

/** Throws 403 unless the signed-in user may do `action` on the product. */
export async function assertCan(req: Request, productId: string, action: IdeasAction): Promise<void> {
  const user = req.user;
  if (!user) throw unauthenticated();
  const memberships = req.memberships ?? (await getMemberships(user.id));
  if (!canDo(user, memberships, productId, action)) throw forbidden(DENIED[action]);
}

/**
 * Route guard for routes that carry the product id in the query or body.
 * Routes keyed by an idea, plan or item id call `assertCan` after loading the record.
 */
export function requireIdeasAccess(from: 'query' | 'body', action: IdeasAction): RequestHandler {
  return async (req, _res, next) => {
    try {
      const source = from === 'query' ? req.query : (req.body as Record<string, unknown> | undefined);
      const productId = source?.productId;
      if (typeof productId !== 'string' || productId.length === 0) {
        throw badRequest('Product id is missing.');
      }
      await assertCan(req, productId, action);
      next();
    } catch (err) {
      next(err);
    }
  };
}
