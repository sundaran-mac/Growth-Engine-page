/**
 * Structured logger (pino). Pretty output only in development on a terminal; JSON everywhere else.
 */
import { pino, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

const pretty = env.nodeEnv === 'development' && process.stdout.isTTY === true;

const options: LoggerOptions = {
  level: env.logLevel,
  base: { service: 'growth-desk-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redacted]',
  },
  ...(pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }
    : {}),
};

export const logger = pino(options);
export type Logger = typeof logger;
