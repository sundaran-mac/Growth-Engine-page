/**
 * Who may do what in Review and Approvals. Pure functions over the signed-in user.
 *
 * - Read (review queue, review, comments, approvals): admin, editor, or a member of the product.
 * - Review (tick the checklist, comment): the same people, except the global `viewer` role.
 * - Send (send for approval, send back to the brief): admin, editor, or product owner, backup
 *   or maker.
 * - Decide a gate: only the named approver, or the named backup after escalation. Nobody else,
 *   not even an admin. Claude never decides: decisions only come from a signed-in person.
 */
import type { Request } from 'express';
import type { Membership, ProductRole, Role } from '@growth-desk/contract';
import { unauthenticated } from '../../lib/errors.js';

export interface Actor {
  id: string;
  role: Role;
  isBrandApprover: boolean;
  memberships: readonly Membership[];
}

export function actorFrom(req: Request): Actor {
  if (!req.user) throw unauthenticated();
  return {
    id: req.user.id,
    role: req.user.role,
    isBrandApprover: req.user.isBrandApprover,
    memberships: req.memberships ?? [],
  };
}

const SEND_ROLES: readonly ProductRole[] = ['owner', 'backup', 'maker'];

export function seesAllProducts(actor: Actor): boolean {
  return actor.role === 'admin' || actor.role === 'editor';
}

export function productRoles(actor: Actor, productId: string): ProductRole[] {
  return actor.memberships.filter((m) => m.productId === productId).map((m) => m.productRole);
}

export function canReadProduct(actor: Actor, productId: string): boolean {
  return seesAllProducts(actor) || productRoles(actor, productId).length > 0;
}

export function canReviewProduct(actor: Actor, productId: string): boolean {
  return actor.role !== 'viewer' && canReadProduct(actor, productId);
}

export function canSendProduct(actor: Actor, productId: string): boolean {
  if (seesAllProducts(actor)) return true;
  if (actor.role === 'viewer') return false;
  return productRoles(actor, productId).some((r) => SEND_ROLES.includes(r));
}

/** Product ids the actor may read, or `all`. */
export function readableProductIds(actor: Actor): 'all' | string[] {
  if (seesAllProducts(actor)) return 'all';
  return [...new Set(actor.memberships.map((m) => m.productId))];
}

export interface DecidableApproval {
  approverId: string | null;
  backupId: string | null;
  escalatedAt: Date | null;
}

/** The named approver, or the named backup once the gate has escalated. */
export function isAssignedDecider(actor: Actor, a: DecidableApproval): boolean {
  if (a.approverId !== null && a.approverId === actor.id) return true;
  return a.backupId !== null && a.backupId === actor.id && a.escalatedAt !== null;
}
