/**
 * Builds the Express app. Exported without listening, so tests use it with Supertest.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './lib/errors.js';
import { httpLogger } from './middleware/http-logger.js';
import { originCheck } from './middleware/origin-check.js';
import { API_PREFIX, buildApiRouter } from './modules/index.js';

export const JSON_LIMIT = '1mb';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);

  app.use(httpLogger);
  app.use(
    helmet({
      // JSON API only: nothing may be rendered or framed from here.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: env.webOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(
    express.json({
      limit: JSON_LIMIT,
      verify: (req, _res, buf) => {
        if (req.url?.startsWith(`${API_PREFIX}/webhooks/`)) (req as express.Request).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(API_PREFIX, originCheck);
  app.use(API_PREFIX, buildApiRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
