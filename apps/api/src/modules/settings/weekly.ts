/**
 * Weekly run per product (default Monday 07:00 in the product time zone):
 *   1. IDEAS drafts new ideas (`generateIdeas`), 2. IDEAS reviews open ideas (`reviewIdeas`),
 *   3. INSIGHTS writes the Monday note (`writeMondayNote`),
 *   4. when PRs are on: branch `growth-weekly-<week>`, commit `docs/growth/weekly/<week>.md`, open a PR.
 * Every step is logged. A failure marks the run failed with the error and tells the owner.
 * No silent retry. Scheduled runs are unique per product and week (partial unique index).
 */
import { and, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import {
  CONTENT_MODE_LABELS,
  PLATFORM_LABELS,
  type Idea,
  type ListResponse,
  type Platform,
  type WeeklyRun,
} from '@growth-desk/contract';
import { db } from '../../db/client.js';
import {
  channelAccounts,
  productChannels,
  productMembers,
  productSettings,
  products,
  users,
  weeklyRuns,
} from '../../db/schema/index.js';
import { writeAudit } from '../../lib/audit.js';
import { isClaudeEnabled } from '../../lib/claude.js';
import { AppError, conflict } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notifyMany } from '../../lib/notifications.js';
import { generateIdeas, reviewIdeas, type IdeasReviewResult } from '../ideas/shared.js';
import { writeMondayNote, type MondayNote } from '../insights/shared.js';
import { createWeeklyPullRequest, isGithubEnabled } from './github.js';
import { weeklyRunJob } from './queue.js';
import {
  computeNextFreeSlots,
  ensureSettingsRow,
  getProductOr404,
  type AuditCtx,
} from './service.js';
import { toIsoWeekday, type SlotCandidate } from './slots.js';

type RunRow = typeof weeklyRuns.$inferSelect;

export const PR_SKIPPED_NO_GITHUB = 'PR skipped: GitHub not connected';

/* ---------- When is a run due (pure) ---------- */

export interface WeekRunTime {
  /** Monday of the local week, `YYYY-MM-DD`. */
  weekStart: string;
  /** The run instant this week (UTC). */
  runAt: Date;
}

/** This week's run time for a product in its zone. ISO weeks start on Monday. */
export function weekRunTime(
  now: Date,
  timezone: string,
  runDay: number,
  runTime: string,
): WeekRunTime {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const monday = local.startOf('week');
  const day = monday.plus({ days: toIsoWeekday(runDay) - 1 });
  const [h, m] = runTime.split(':').map(Number);
  const at = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour: h ?? 0, minute: m ?? 0 },
    { zone: timezone },
  );
  return { weekStart: monday.toISODate()!, runAt: at.toJSDate() };
}

export function isRunDue(
  now: Date,
  timezone: string,
  runDay: number,
  runTime: string,
): WeekRunTime | null {
  const t = weekRunTime(now, timezone, runDay, runTime);
  return now.getTime() >= t.runAt.getTime() ? t : null;
}

/** Monday of the current local week in the zone. */
export function currentWeekStart(now: Date, timezone: string): string {
  return DateTime.fromJSDate(now, { zone: timezone }).startOf('week').toISODate()!;
}

/* ---------- DTO and listing ---------- */

function toDto(row: RunRow, user: { name: string | null; initials: string | null }): WeeklyRun {
  return {
    id: row.id,
    productId: row.productId,
    weekStart: row.weekStart,
    status: row.status,
    ideasCreated: row.ideasCreated,
    noteId: row.noteId,
    githubPrUrl: row.githubPrUrl,
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    triggeredBy: row.triggeredBy,
    triggeredByUser:
      row.triggeredByUserId && user.name
        ? { id: row.triggeredByUserId, name: user.name, initials: user.initials ?? '' }
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getRunDto(id: string): Promise<WeeklyRun | null> {
  const [r] = await db
    .select({ run: weeklyRuns, name: users.name, initials: users.initials })
    .from(weeklyRuns)
    .leftJoin(users, eq(users.id, weeklyRuns.triggeredByUserId))
    .where(eq(weeklyRuns.id, id));
  return r ? toDto(r.run, r) : null;
}

export async function listRuns(
  productId: string,
  limit: number,
  offset: number,
): Promise<ListResponse<WeeklyRun>> {
  await getProductOr404(productId);
  const rows = await db
    .select({ run: weeklyRuns, name: users.name, initials: users.initials })
    .from(weeklyRuns)
    .leftJoin(users, eq(users.id, weeklyRuns.triggeredByUserId))
    .where(eq(weeklyRuns.productId, productId))
    .orderBy(desc(weeklyRuns.createdAt), desc(weeklyRuns.id))
    .limit(limit)
    .offset(offset);
  const [total] = await db
    .select({ n: count() })
    .from(weeklyRuns)
    .where(eq(weeklyRuns.productId, productId));
  return { items: rows.map((r) => toDto(r.run, r)), total: total?.n ?? 0 };
}

/* ---------- Starting runs ---------- */

/** "Run now". Refused while another run of the product is queued or running. */
export async function startManualRun(productId: string, ctx: AuditCtx): Promise<WeeklyRun> {
  const settings = await ensureSettingsRow(productId);
  const weekStart = currentWeekStart(new Date(), settings.timezone);
  const id = await db.transaction(async (tx) => {
    // One run at a time per product, even with two clicks at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`weekly-run:${productId}`}))`);
    const [busy] = await tx
      .select({ id: weeklyRuns.id })
      .from(weeklyRuns)
      .where(
        and(eq(weeklyRuns.productId, productId), inArray(weeklyRuns.status, ['queued', 'running'])),
      );
    if (busy)
      throw conflict('A weekly run is already in progress for this product.', 'RUN_IN_PROGRESS');
    const [row] = await tx
      .insert(weeklyRuns)
      .values({ productId, weekStart, triggeredBy: 'manual', triggeredByUserId: ctx.actorId! })
      .returning({ id: weeklyRuns.id });
    await writeAudit(
      {
        ...ctx,
        action: 'weekly_run.start',
        entity: 'weekly_run',
        entityId: row!.id,
        after: { productId, weekStart },
      },
      tx,
    );
    return row!.id;
  });
  await weeklyRunJob.send({ runId: id }, { singletonKey: id });
  return (await getRunDto(id))!;
}

/** Cron body: queue one scheduled run per due product (idempotent per product and week). */
export async function enqueueDueRuns(now = new Date()): Promise<string[]> {
  // Products created after the last tick get their default settings row here.
  await db.execute(sql`
    insert into product_settings (product_id)
    select p.id from products p
    where p.status <> 'archived'
      and not exists (select 1 from product_settings s where s.product_id = p.id)
    on conflict do nothing`);
  const rows = await db
    .select({
      productId: productSettings.productId,
      timezone: productSettings.timezone,
      day: productSettings.weeklyRunDay,
      time: productSettings.weeklyRunTime,
    })
    .from(productSettings)
    .innerJoin(products, eq(products.id, productSettings.productId))
    .where(and(eq(productSettings.weeklyRunEnabled, true), ne(products.status, 'archived')));
  const queued: string[] = [];
  for (const r of rows) {
    let due: WeekRunTime | null;
    try {
      due = isRunDue(now, r.timezone, r.day, r.time);
    } catch (err) {
      logger.error({ err, productId: r.productId }, 'weekly run time not readable');
      continue;
    }
    if (!due) continue;
    const [created] = await db
      .insert(weeklyRuns)
      .values({ productId: r.productId, weekStart: due.weekStart, triggeredBy: 'schedule' })
      .onConflictDoNothing()
      .returning({ id: weeklyRuns.id });
    if (!created) continue;
    await writeAudit({
      actorId: null,
      action: 'weekly_run.schedule',
      entity: 'weekly_run',
      entityId: created.id,
      after: { productId: r.productId, weekStart: due.weekStart },
    });
    await weeklyRunJob.send({ runId: created.id }, { singletonKey: created.id });
    queued.push(created.id);
  }
  return queued;
}

/* ---------- Crash safety ---------- */

/** A run still `running` after this long lost its worker (Claude calls time out well before). */
export const STALE_RUN_MINUTES = 60;
export const STALE_RUN_ERROR = 'Worker stopped during the run';

/**
 * Cron body (runs first in every `weekly.tick`): a run stuck in `running` for more than
 * STALE_RUN_MINUTES means the worker stopped mid-run (crash, deploy, out of memory). Mark it
 * failed, write the audit log and tell the owner (and the person who pressed Run now). This
 * frees "Run now" (which refuses while a run is queued or running). No silent retry: the
 * owner decides whether to run again; next week's scheduled run starts as usual.
 */
export async function failStaleRuns(now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - STALE_RUN_MINUTES * 60_000);
  // One transaction: the status change, its audit row and the notices commit together.
  const stale = await db.transaction(async (tx) => {
    const rows = await tx
      .update(weeklyRuns)
      .set({ status: 'failed', error: STALE_RUN_ERROR, finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(weeklyRuns.status, 'running'),
          lt(sql`coalesce(${weeklyRuns.startedAt}, ${weeklyRuns.updatedAt})`, cutoff),
        ),
      )
      .returning({
        id: weeklyRuns.id,
        productId: weeklyRuns.productId,
        startedAt: weeklyRuns.startedAt,
        triggeredByUserId: weeklyRuns.triggeredByUserId,
      });
    for (const run of rows) {
      const [product] = await tx
        .select({ name: products.name, ownerId: products.ownerId })
        .from(products)
        .where(eq(products.id, run.productId));
      await writeAudit(
        {
          actorId: null,
          action: 'weekly_run.fail',
          entity: 'weekly_run',
          entityId: run.id,
          before: { status: 'running', startedAt: run.startedAt?.toISOString() ?? null },
          after: { status: 'failed', error: STALE_RUN_ERROR },
        },
        tx,
      );
      await notifyMany(
        [product?.ownerId, run.triggeredByUserId],
        {
          kind: 'system',
          title: `${product?.name ?? 'Product'}: weekly run failed`,
          body: `${STALE_RUN_ERROR}. Use Run now in Settings to try again.`,
          link: '/settings?tab=claude',
          entity: 'weekly_run',
          entityId: run.id,
        },
        tx,
      );
    }
    return rows;
  });
  for (const run of stale) {
    logger.warn({ weeklyRunId: run.id, productId: run.productId }, 'stale weekly run failed');
  }
  return stale.map((r) => r.id);
}

/* ---------- The weekly proposal file (pure) ---------- */

export interface ProposalInput {
  productName: string;
  weekStart: string;
  timezone: string;
  ideas: Idea[];
  review: IdeasReviewResult;
  note: MondayNote;
  plan: { idea: Idea; slot: SlotCandidate }[];
}

/** The long dash, never allowed in Growth Desk text. */
const EM_DASH = String.fromCharCode(0x2014);

const clean = (s: string) =>
  s
    .replaceAll(EM_DASH, ', ')
    .replace(/\r?\n+/g, ' ')
    .trim();

export function buildProposalMarkdown(p: ProposalInput): string {
  const lines: string[] = [
    `# Growth weekly proposal: ${p.productName}, week of ${p.weekStart}`,
    '',
    'Written by the Growth Desk weekly run. Claude drafts; people decide. Nothing here is approved.',
    '',
    '## Monday note',
    '',
    clean(p.note.summary),
    '',
    `- Do more of: ${clean(p.note.doMore)}`,
    `- Stop: ${clean(p.note.stop)}`,
    '',
    `## New ideas (${p.ideas.length})`,
    '',
  ];
  if (p.ideas.length === 0) lines.push('No new ideas this week.');
  else {
    lines.push('| Idea | Mode | Fit | Channels |', '| --- | --- | --- | --- |');
    for (const i of p.ideas) {
      const channels = i.channels.map((c) => PLATFORM_LABELS[c]).join(', ') || 'Any';
      lines.push(
        `| ${clean(i.title).replace(/\|/g, '/')} | ${i.mode} ${CONTENT_MODE_LABELS[i.mode]} | ${i.fitScore ?? '-'} | ${channels} |`,
      );
    }
  }
  lines.push(
    '',
    '## Review of open ideas',
    '',
    `- Re-scored: ${p.review.rescored}`,
    `- Flagged as stale: ${p.review.flaggedStale}`,
    '',
    '## Proposed plan',
    '',
  );
  if (p.plan.length === 0) lines.push('No free posting slots or no ideas to place.');
  else {
    for (const { idea, slot } of p.plan) {
      const when = DateTime.fromJSDate(slot.at, { zone: slot.audienceTimezone }).toFormat(
        'ccc d LLL, HH:mm ZZZZ',
      );
      lines.push(
        `- ${when} on ${PLATFORM_LABELS[slot.platform]}: ${clean(idea.title)} (${idea.mode})`,
      );
    }
  }
  lines.push('', `Time zone of the product: ${p.timezone}.`, '');
  return lines.join('\n');
}

/** Pairs the best new ideas with the next free slots (best fit first, earliest slot first). */
export function proposePlan(
  ideas: Idea[],
  slots: SlotCandidate[],
): { idea: Idea; slot: SlotCandidate }[] {
  const ranked = [...ideas].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
  const out: { idea: Idea; slot: SlotCandidate }[] = [];
  const used = new Set<number>();
  for (const idea of ranked) {
    const idx = slots.findIndex(
      (s, i) => !used.has(i) && (idea.channels.length === 0 || idea.channels.includes(s.platform)),
    );
    if (idx < 0) continue;
    used.add(idx);
    out.push({ idea, slot: slots[idx]! });
  }
  return out.sort((a, b) => a.slot.at.getTime() - b.slot.at.getTime());
}

/* ---------- Running ---------- */

export interface WeeklyRunDeps {
  generateIdeas: typeof generateIdeas;
  reviewIdeas: typeof reviewIdeas;
  writeMondayNote: typeof writeMondayNote;
  claudeEnabled: () => boolean;
  githubEnabled: () => boolean;
  createPullRequest: typeof createWeeklyPullRequest;
  now: () => Date;
}

const defaultDeps: WeeklyRunDeps = {
  generateIdeas,
  reviewIdeas,
  writeMondayNote,
  claudeEnabled: isClaudeEnabled,
  githubEnabled: isGithubEnabled,
  createPullRequest: createWeeklyPullRequest,
  now: () => new Date(),
};

async function recipients(
  productId: string,
  ownerId: string | null,
  extra: string | null,
): Promise<string[]> {
  const makers = await db
    .select({ userId: productMembers.userId })
    .from(productMembers)
    .where(
      and(
        eq(productMembers.productId, productId),
        inArray(productMembers.productRole, ['owner', 'maker']),
      ),
    );
  return [ownerId, extra, ...makers.map((m) => m.userId)].filter((x): x is string => Boolean(x));
}

async function enabledPlatforms(productId: string): Promise<Platform[]> {
  const rows = await db
    .selectDistinct({ platform: channelAccounts.platform })
    .from(productChannels)
    .innerJoin(channelAccounts, eq(channelAccounts.id, productChannels.channelAccountId))
    .where(and(eq(productChannels.productId, productId), eq(productChannels.enabled, true)));
  return rows.map((r) => r.platform);
}

function errorText(err: unknown): string {
  if (err instanceof AppError) return err.detail ?? err.title;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

/** Job body for `weekly.run`. Safe to call twice: only a queued run starts. */
export async function executeWeeklyRun(
  runId: string,
  deps: WeeklyRunDeps = defaultDeps,
): Promise<void> {
  const [run] = await db
    .update(weeklyRuns)
    .set({ status: 'running', startedAt: deps.now(), error: null, updatedAt: new Date() })
    .where(and(eq(weeklyRuns.id, runId), eq(weeklyRuns.status, 'queued')))
    .returning();
  if (!run) return;
  const log = logger.child({ weeklyRunId: runId, productId: run.productId });
  const product = await getProductOr404(run.productId);
  const settings = await ensureSettingsRow(run.productId);
  const notifyTo = await recipients(run.productId, product.ownerId, run.triggeredByUserId);

  const finish = async (patch: Partial<typeof weeklyRuns.$inferInsert>) => {
    await db
      .update(weeklyRuns)
      .set({ ...patch, finishedAt: deps.now(), updatedAt: new Date() })
      .where(eq(weeklyRuns.id, runId));
  };

  if (!deps.claudeEnabled()) {
    log.info('weekly run skipped: Claude not connected');
    await finish({ status: 'skipped', error: 'Skipped: Claude is not connected.' });
    await writeAudit({
      actorId: null,
      action: 'weekly_run.skip',
      entity: 'weekly_run',
      entityId: runId,
      after: { reason: 'claude_off' },
    });
    return;
  }

  let step = 'ideas';
  try {
    log.info('weekly run step: ideas');
    const ideas = await deps.generateIdeas(
      run.productId,
      {
        count: settings.weeklyIdeasCount,
        ...(settings.weeklyModes.length > 0 ? { modes: settings.weeklyModes } : {}),
        source: 'weekly',
        weeklyRunId: runId,
      },
      run.triggeredByUserId,
    );
    await db
      .update(weeklyRuns)
      .set({ ideasCreated: ideas.length, updatedAt: new Date() })
      .where(eq(weeklyRuns.id, runId));

    step = 'review';
    log.info('weekly run step: review');
    const review = await deps.reviewIdeas(run.productId);

    step = 'note';
    log.info('weekly run step: note');
    const note = await deps.writeMondayNote(run.productId, run.weekStart);
    await db
      .update(weeklyRuns)
      .set({ noteId: note.id, updatedAt: new Date() })
      .where(eq(weeklyRuns.id, runId));

    let prUrl: string | null = null;
    let prNote: string | null = null;
    if (settings.weeklyPrEnabled && settings.githubRepo) {
      if (!deps.githubEnabled()) {
        prNote = PR_SKIPPED_NO_GITHUB;
        log.info(prNote);
      } else {
        step = 'pull request';
        log.info('weekly run step: pull request');
        const platforms = await enabledPlatforms(run.productId);
        const slots = await computeNextFreeSlots(
          run.productId,
          platforms,
          deps.now(),
          Math.max(ideas.length, 1),
        );
        const markdown = buildProposalMarkdown({
          productName: product.name,
          weekStart: run.weekStart,
          timezone: settings.timezone,
          ideas,
          review,
          note,
          plan: proposePlan(ideas, slots),
        });
        const pr = await deps.createPullRequest({
          repo: settings.githubRepo,
          base: settings.githubBaseBranch,
          branch: `growth-weekly-${run.weekStart}`,
          path: `docs/growth/weekly/${run.weekStart}.md`,
          content: markdown,
          title: `Growth weekly proposal: ${product.name}, week of ${run.weekStart}`,
          body: `Weekly ideas, scores, the Monday note and a proposed plan from Growth Desk.\n\n${ideas.length} new ideas. Review and merge what the team accepts.`,
        });
        prUrl = pr.url;
      }
    }

    await finish({ status: 'done', githubPrUrl: prUrl, error: prNote });
    await writeAudit({
      actorId: null,
      action: 'weekly_run.done',
      entity: 'weekly_run',
      entityId: runId,
      after: { ideasCreated: ideas.length, noteId: note.id, githubPrUrl: prUrl, note: prNote },
    });
    await notifyMany(notifyTo, {
      kind: 'ideas_ready',
      title: `${product.name}: weekly run done, ${ideas.length} new ideas`,
      body: prUrl ? `Pull request: ${prUrl}` : (prNote ?? 'The Monday note is ready.'),
      link: '/ideas',
      entity: 'weekly_run',
      entityId: runId,
    });
    log.info({ ideas: ideas.length, prUrl }, 'weekly run done');
  } catch (err) {
    const message = `Failed at ${step}: ${errorText(err)}`;
    log.error({ err, step }, 'weekly run failed');
    await finish({ status: 'failed', error: message.slice(0, 1000) });
    await writeAudit({
      actorId: null,
      action: 'weekly_run.fail',
      entity: 'weekly_run',
      entityId: runId,
      after: { step, error: message },
    });
    await notifyMany([product.ownerId, run.triggeredByUserId], {
      kind: 'system',
      title: `${product.name}: weekly run failed`,
      body: message.slice(0, 300),
      link: '/settings?tab=claude',
      entity: 'weekly_run',
      entityId: runId,
    });
  }
}
