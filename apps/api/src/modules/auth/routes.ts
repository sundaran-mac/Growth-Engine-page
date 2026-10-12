/**
 * Auth routes (owned by FOUNDATION-API):
 *   POST /api/v1/auth/login   { email, password } -> 200 MeResponse + gd_session cookie
 *   POST /api/v1/auth/logout  -> 204, cookie cleared
 *   GET  /api/v1/auth/me      -> 200 MeResponse, 401 when not signed in
 */
import { Router } from 'express';
import { loginRequestSchema, type MeResponse } from '@growth-desk/contract';
import { auditContext, writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import {
  clearSessionCookie,
  readSessionToken,
  requireAuth,
  setSessionCookie,
} from '../../middleware/auth.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { parsed, validate } from '../../middleware/validate.js';
import {
  buildMe,
  createSession,
  deleteSessionByToken,
  toSessionUser,
  verifyCredentials,
} from './service.js';

export const authRouter: Router = Router();

authRouter.post(
  '/auth/login',
  authRateLimit,
  validate({ body: loginRequestSchema }),
  async (req, res) => {
    const { email, password } = parsed<{ email: string; password: string }>(req).body;
    const user = await verifyCredentials(email, password);
    if (!user) {
      req.log.warn({ email }, 'sign-in failed');
      throw new AppError({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        title: 'Sign-in failed',
        detail: 'Email or password is not correct.',
      });
    }

    // New session on every sign-in (no session fixation). Drop the old one if the browser had it.
    const previous = readSessionToken(req);
    if (previous) await deleteSessionByToken(previous);

    const session = await createSession(user.id, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    await writeAudit({
      ...auditContext(req),
      actorId: user.id,
      action: 'auth.login',
      entity: 'session',
      entityId: session.sessionId,
    });
    setSessionCookie(res, session.token);
    const body: MeResponse = await buildMe(toSessionUser(user));
    res.status(200).json(body);
  },
);

authRouter.post('/auth/logout', async (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    const userId = await deleteSessionByToken(token);
    if (userId) {
      await writeAudit({
        ...auditContext(req),
        actorId: userId,
        action: 'auth.logout',
        entity: 'session',
      });
    }
  }
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const body: MeResponse = {
    user: req.user!,
    memberships: req.memberships ?? (await buildMe(req.user!)).memberships,
  };
  res.json(body);
});
