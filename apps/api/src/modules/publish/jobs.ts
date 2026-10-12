/**
 * Job definitions of the publish module. Shared by the service (to send) and
 * `jobs/publish.ts` (to work), so neither imports the other.
 */
import { defineJob } from '../../lib/queue.js';

/** Publish one post. Never retried by the queue: a failure is handled by the fail-safe rule. */
export const postPublishJob = defineJob<{ postId: string }>('post.publish', { retryLimit: 0 });

/** Every minute: queue due posts and due WhatsApp reminders (also covers a lost job). */
export const postSweepJob = defineJob<Record<string, never>>('post.sweep', { retryLimit: 0 });

/** Remind the owner to post a WhatsApp (or manual) post by hand, with the file. */
export const whatsappReminderJob = defineJob<{ postId: string }>('whatsapp.reminder', { retryLimit: 2 });

/** Daily: refresh channel tokens that expire soon, warn about the ones we cannot refresh. */
export const tokenRefreshJob = defineJob<Record<string, never>>('channel.token-refresh', { retryLimit: 1 });
