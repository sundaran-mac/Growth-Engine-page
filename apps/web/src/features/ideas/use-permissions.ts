import { useMemo } from 'react';
import { useSessionStore } from '@/stores/session';
import { ideasPermissions, type IdeasPermissions } from './lib';

/** What the signed-in user may do on the Ideas board and Plan for this product. */
export function useIdeasPermissions(productId: string | null): IdeasPermissions {
  const user = useSessionStore((s) => s.user);
  const memberships = useSessionStore((s) => s.memberships);
  return useMemo(() => ideasPermissions(user, memberships, productId), [user, memberships, productId]);
}
