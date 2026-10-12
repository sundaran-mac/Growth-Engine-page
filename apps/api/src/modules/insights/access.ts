/**
 * Access rules for INSIGHTS writes.
 * - Reading dashboards, analytics, notes and leads: any signed-in user.
 * - Leads (create, edit, move, log): admin and editor on every product; member only on products
 *   where they hold a product role. Viewers never.
 * - Keyword rules and the Monday note: admin and editor, or the product owner or backup.
 */
import type { Request } from 'express';
import type { ProductRole } from '@growth-desk/contract';
import { forbidden, unauthenticated } from '../../lib/errors.js';
import { getMemberships } from '../auth/service.js';

async function memberships(req: Request) {
  if (!req.user) throw unauthenticated();
  return req.memberships ?? (await getMemberships(req.user.id));
}

/** Throws 403 unless the user may change this product's records. Empty roles = any product role. */
export async function assertProductWriter(
  req: Request,
  productId: string,
  productRoles: readonly ProductRole[] = [],
): Promise<void> {
  if (!req.user) throw unauthenticated();
  const { role } = req.user;
  if (role === 'admin' || role === 'editor') return;
  if (role === 'viewer') throw forbidden('Viewers cannot change records.');
  const list = await memberships(req);
  const ok = list.some(
    (m) =>
      m.productId === productId &&
      (productRoles.length === 0 || productRoles.includes(m.productRole)),
  );
  if (!ok) throw forbidden('You do not have this role on the product.');
}

export const LEAD_WRITER_ROLES: readonly ProductRole[] = [];
export const OWNER_ROLES: readonly ProductRole[] = ['owner', 'backup'];
