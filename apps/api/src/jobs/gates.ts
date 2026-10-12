/**
 * Gates jobs. `approval.escalate` runs every 15 minutes: pending approvals past their due time
 * are escalated once to the named backup (notified). No backup means the piece waits.
 * The job never approves anything. It is idempotent: running it twice escalates nothing new.
 */
import { defineJob, type PgBoss } from '../lib/queue.js';
import { escalateDueApprovals } from '../modules/gates/service.js';

export const ESCALATE_CRON = '*/15 * * * *';

// No retries: the next run 15 minutes later picks up anything this run missed.
export const approvalEscalate = defineJob<Record<string, never>>('approval.escalate', {
  retryLimit: 0,
});

export async function register(_boss: PgBoss): Promise<void> {
  await approvalEscalate.work(async () => {
    await escalateDueApprovals(new Date());
  });
  await approvalEscalate.schedule(ESCALATE_CRON, {});
}
