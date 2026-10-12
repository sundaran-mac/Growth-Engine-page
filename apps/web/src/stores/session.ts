import { create } from 'zustand';
import type { Membership, MeResponse, SessionUser } from '@growth-desk/contract';

export type SessionStatus = 'unknown' | 'signedIn' | 'signedOut';

interface SessionState {
  user: SessionUser | null;
  memberships: Membership[];
  status: SessionStatus;
  setSession: (me: MeResponse) => void;
  clearSession: () => void;
}

/** Who is signed in. Server data lives in TanStack Query; this mirrors /auth/me for quick access. */
export const useSessionStore = create<SessionState>()((set) => ({
  user: null,
  memberships: [],
  status: 'unknown',
  setSession: (me) => set({ user: me.user, memberships: me.memberships, status: 'signedIn' }),
  clearSession: () => set({ user: null, memberships: [], status: 'signedOut' }),
}));

/** The signed-in user's role on one product, or null. */
export function productRoleOf(memberships: Membership[], productId: string | null) {
  if (!productId) return null;
  return memberships.find((m) => m.productId === productId)?.productRole ?? null;
}
