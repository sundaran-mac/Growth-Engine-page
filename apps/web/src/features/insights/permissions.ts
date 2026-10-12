/**
 * Client-side mirror of the INSIGHTS write rules (the API enforces them; this only hides buttons).
 */
import { useSessionStore } from '@/stores/session';

/** Leads: admin and editor everywhere; member on products where they hold a role. */
export function useCanEditLeads(productId: string | null): boolean {
  const user = useSessionStore((s) => s.user);
  const memberships = useSessionStore((s) => s.memberships);
  if (!user || user.role === 'viewer') return false;
  if (user.role === 'admin' || user.role === 'editor') return true;
  if (!productId) return memberships.length > 0;
  return memberships.some((m) => m.productId === productId);
}

/** Keyword rules and the Monday note: admin, editor, or the product owner or backup. */
export function useCanManageProduct(productId: string | null): boolean {
  const user = useSessionStore((s) => s.user);
  const memberships = useSessionStore((s) => s.memberships);
  if (!user || user.role === 'viewer') return false;
  if (user.role === 'admin' || user.role === 'editor') return true;
  return memberships.some(
    (m) => m.productId === productId && (m.productRole === 'owner' || m.productRole === 'backup'),
  );
}
