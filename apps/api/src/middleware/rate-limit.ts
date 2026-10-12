/**
 * Rate limits. Auth: 10 attempts per 15 minutes per IP (successful logins do not count).
 */
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError, sendProblem } from '../lib/errors.js';

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    sendProblem(
      res,
      new AppError({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Too many attempts',
        detail: 'Too many sign-in attempts. Wait 15 minutes and try again.',
      }),
      req.originalUrl,
      req.id ? String(req.id) : undefined,
    );
  },
});
