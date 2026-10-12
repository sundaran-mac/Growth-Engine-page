/**
 * pino-http: one structured log line per request, with the request id. Sets `req.id` and `req.log`.
 */
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.js';
import { genRequestId } from './request-id.js';

export const httpLogger = pinoHttp({
  logger,
  genReqId: genRequestId,
  autoLogging: { ignore: (req) => req.url === '/api/v1/health/live' },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  customProps: (req) => ({ userId: (req as { user?: { id: string } }).user?.id }),
});
