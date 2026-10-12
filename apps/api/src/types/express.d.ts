/**
 * Fields added to Express requests by our middleware.
 */
import type { Membership, SessionUser } from '@growth-desk/contract';

declare global {
  namespace Express {
    interface Request {
      /** Signed-in user, set by `requireAuth` (or `loadSession`). */
      user?: SessionUser;
      /** Product memberships of the signed-in user. */
      memberships?: Membership[];
      /** Current session id (not the cookie token). */
      sessionId?: string;
      /** Raw request body bytes, kept only for /api/v1/webhooks/* (signature checks). */
      rawBody?: Buffer;
    }
  }
}

export {};
