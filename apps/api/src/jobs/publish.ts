/**
 * publish jobs (worker only):
 * - `post.sweep` every minute: queues due posts and due WhatsApp reminders.
 * - `post.publish`: publishes one post; no queue retry (fail-safe rule, BUILD-PLAN section 4).
 * - `whatsapp.reminder`: tells the owner to post by hand, with the file on the Publish screen.
 * - `channel.token-refresh` daily at 03:00: renews tokens that expire within 7 days.
 */
import type { PgBoss } from '../lib/queue.js';
import { logger } from '../lib/logger.js';
import {
  postPublishJob,
  postSweepJob,
  tokenRefreshJob,
  whatsappReminderJob,
} from '../modules/publish/jobs.js';
import {
  publishPost,
  refreshExpiringTokens,
  sendPostReminder,
  sweepDuePosts,
} from '../modules/publish/service.js';

export async function register(_boss: PgBoss): Promise<void> {
  await postPublishJob.work(async ({ postId }) => {
    const outcome = await publishPost(postId);
    logger.info({ postId, outcome }, 'post.publish finished');
  });

  await whatsappReminderJob.work(async ({ postId }) => {
    const sent = await sendPostReminder(postId);
    logger.info({ postId, sent }, 'whatsapp.reminder finished');
  });

  await postSweepJob.work(async () => {
    const queued = await sweepDuePosts();
    if (queued.publish > 0 || queued.reminders > 0) logger.info(queued, 'post.sweep queued work');
  });
  await postSweepJob.schedule('* * * * *', {});

  await tokenRefreshJob.work(async () => {
    const result = await refreshExpiringTokens();
    logger.info(result, 'channel.token-refresh finished');
  });
  await tokenRefreshJob.schedule('0 3 * * *', {});
}
