/**
 * Foundation jobs (owned by FOUNDATION-API).
 */
import { purgeExpiredSessions } from '../modules/auth/service.js';
import { defineJob } from '../lib/queue.js';
import { logger } from '../lib/logger.js';

export const sessionsPurge = defineJob<Record<string, never>>('system.sessions-purge', {
  retryLimit: 1,
});

export async function register(): Promise<void> {
  await sessionsPurge.work(async () => {
    const removed = await purgeExpiredSessions();
    logger.info({ removed }, 'expired sessions removed');
  });
  // Every day at 03:15 (APP_TIMEZONE).
  await sessionsPurge.schedule('15 3 * * *');
}
