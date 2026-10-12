/**
 * Keyword replies: rules (CIRCLE -> reply with the tracked link), the events they caught, and the
 * Meta webhook that turns an Instagram comment into a lead plus a private reply.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Request } from 'express';
import type { z } from 'zod';
import {
  metaCommentChangeSchema,
  type createKeywordRuleRequestSchema,
  type KeywordEventListResponse,
  type KeywordReplyStatus,
  type KeywordRule,
  type KeywordRuleListResponse,
  type KeywordRuleView,
  type MetaWebhookPayload,
  type MetaWebhookResult,
  type updateKeywordRuleRequestSchema,
} from '@growth-desk/contract';
import { db } from '../../db/client.js';
import {
  briefs,
  channelAccounts,
  keywordEvents,
  keywordRules,
  leadActivities,
  leads,
  posts,
  products,
} from '../../db/schema/index.js';
import { auditContext, writeAudit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notifyMany } from '../../lib/notifications.js';
import { toCount } from '../../lib/pagination.js';
import { sendInstagramPrivateReply, type PrivateReplyResult } from '../publish/shared.js';
import { assertProductWriter, OWNER_ROLES } from './access.js';
import { buildReplyMessage, findMatchingRule } from './logic.js';

type KeywordRuleRow = typeof keywordRules.$inferSelect;

function toKeywordRule(r: KeywordRuleRow): KeywordRule {
  return {
    id: r.id,
    productId: r.productId,
    platform: r.platform,
    keyword: r.keyword,
    replyText: r.replyText,
    link: r.link,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/* ---------- Rules ---------- */

export async function listKeywordRules(productId?: string): Promise<KeywordRuleListResponse> {
  const rows = await db
    .select({
      rule: keywordRules,
      queuedCount:
        sql<string>`count(${keywordEvents.id}) filter (where ${keywordEvents.replyStatus} = 'queued')`.mapWith(
          toCount,
        ),
      eventCount: sql<string>`count(${keywordEvents.id})`.mapWith(toCount),
    })
    .from(keywordRules)
    .leftJoin(keywordEvents, eq(keywordEvents.ruleId, keywordRules.id))
    .where(productId ? eq(keywordRules.productId, productId) : undefined)
    .groupBy(keywordRules.id)
    .orderBy(asc(keywordRules.keyword));
  const items: KeywordRuleView[] = rows.map((r) => ({
    ...toKeywordRule(r.rule),
    queuedCount: r.queuedCount,
    eventCount: r.eventCount,
  }));
  return { items, total: items.length };
}

export async function createKeywordRule(
  req: Request,
  body: z.output<typeof createKeywordRuleRequestSchema>,
): Promise<KeywordRuleView> {
  await assertProductWriter(req, body.productId, OWNER_ROLES);
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, body.productId));
  if (!product) throw badRequest('The product does not exist.');
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(keywordRules)
      .values({
        productId: body.productId,
        platform: body.platform,
        keyword: body.keyword,
        replyText: body.replyText,
        link: body.link ?? null,
        active: body.active,
      })
      .returning();
    await writeAudit(
      {
        ...auditContext(req),
        action: 'keyword_rule.create',
        entity: 'keyword_rule',
        entityId: row!.id,
        after: row,
      },
      tx,
    );
    return { ...toKeywordRule(row!), queuedCount: 0, eventCount: 0 };
  });
}

export async function updateKeywordRule(
  req: Request,
  id: string,
  body: z.output<typeof updateKeywordRuleRequestSchema>,
): Promise<KeywordRuleView> {
  const [before] = await db.select().from(keywordRules).where(eq(keywordRules.id, id));
  if (!before) throw notFound('Keyword rule');
  await assertProductWriter(req, before.productId, OWNER_ROLES);
  const set: Partial<typeof keywordRules.$inferInsert> = {};
  if (body.replyText !== undefined) set.replyText = body.replyText;
  if (body.link !== undefined) set.link = body.link;
  if (body.active !== undefined) set.active = body.active;
  await db.transaction(async (tx) => {
    const [after] = await tx
      .update(keywordRules)
      .set(set)
      .where(eq(keywordRules.id, id))
      .returning();
    await writeAudit(
      {
        ...auditContext(req),
        action: 'keyword_rule.update',
        entity: 'keyword_rule',
        entityId: id,
        before,
        after,
      },
      tx,
    );
  });
  const list = await listKeywordRules(before.productId);
  const view = list.items.find((r) => r.id === id);
  if (!view) throw notFound('Keyword rule');
  return view;
}

/* ---------- Events ---------- */

export async function listKeywordEvents(q: {
  productId?: string | undefined;
  status?: KeywordReplyStatus | undefined;
  limit: number;
  offset: number;
}): Promise<KeywordEventListResponse> {
  const where: SQL[] = [];
  if (q.productId) where.push(eq(keywordRules.productId, q.productId));
  if (q.status) where.push(eq(keywordEvents.replyStatus, q.status));
  const cond = where.length ? and(...where) : undefined;
  const rows = await db
    .select({ event: keywordEvents, keyword: keywordRules.keyword, briefCode: briefs.code })
    .from(keywordEvents)
    .innerJoin(keywordRules, eq(keywordRules.id, keywordEvents.ruleId))
    .leftJoin(posts, eq(posts.id, keywordEvents.postId))
    .leftJoin(briefs, eq(briefs.id, posts.briefId))
    .where(cond)
    .orderBy(desc(keywordEvents.createdAt), desc(keywordEvents.id))
    .limit(q.limit)
    .offset(q.offset);
  const [count] = await db
    .select({ n: sql<string>`count(*)`.mapWith(toCount) })
    .from(keywordEvents)
    .innerJoin(keywordRules, eq(keywordRules.id, keywordEvents.ruleId))
    .where(cond);
  return {
    items: rows.map(({ event: e, keyword, briefCode }) => ({
      id: e.id,
      ruleId: e.ruleId,
      keyword,
      platform: e.platform,
      postId: e.postId,
      briefCode,
      authorHandle: e.authorHandle,
      commentText: e.commentText,
      replyStatus: e.replyStatus as KeywordReplyStatus,
      leadId: e.leadId,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
    })),
    total: count?.n ?? 0,
  };
}

/* ---------- Meta webhook ---------- */

/** The reply sender, swappable in tests. Defaults to PUBLISH's `sendInstagramPrivateReply`. */
export type PrivateReplySender = (input: {
  channelAccountId: string;
  commentId: string;
  message: string;
}) => Promise<PrivateReplyResult>;

interface CommentContext {
  productId: string;
  channelAccountId: string;
  postId: string | null;
  briefCode: string | null;
  trackedUrl: string | null;
}

/** Finds which product, account and post a comment belongs to. Null when we do not know it. */
async function resolveComment(
  accountExternalId: string,
  mediaId: string | undefined,
): Promise<CommentContext | null> {
  if (mediaId) {
    const [post] = await db
      .select({
        postId: posts.id,
        productId: briefs.productId,
        briefCode: briefs.code,
        trackedUrl: posts.trackedUrl,
        channelAccountId: posts.channelAccountId,
      })
      .from(posts)
      .innerJoin(briefs, eq(briefs.id, posts.briefId))
      .innerJoin(channelAccounts, eq(channelAccounts.id, posts.channelAccountId))
      .where(and(eq(posts.externalId, mediaId), eq(channelAccounts.platform, 'instagram')))
      .limit(1);
    if (post) return post;
  }
  const [account] = await db
    .select({ id: channelAccounts.id, productId: channelAccounts.productId })
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.platform, 'instagram'),
        eq(channelAccounts.externalAccountId, accountExternalId),
      ),
    )
    .limit(1);
  if (!account?.productId) return null;
  return {
    productId: account.productId,
    channelAccountId: account.id,
    postId: null,
    briefCode: null,
    trackedUrl: null,
  };
}

function replyOutcome(result: PrivateReplyResult): {
  status: KeywordReplyStatus;
  error: string | null;
} {
  if (result.status === 'sent') return { status: 'sent', error: null };
  if (result.reason === 'ERROR')
    return { status: 'failed', error: result.detail ?? 'Reply failed' };
  // Not connected or not allowed: keep it queued so a person (or a later retry) can send it.
  return { status: 'queued', error: result.detail ?? result.reason };
}

/**
 * Handles a verified webhook payload. Each comment is processed once (dedupe on the platform
 * comment id); a matching keyword creates (or reuses) an open lead and sends the private reply.
 */
export async function processMetaWebhook(
  payload: MetaWebhookPayload,
  sendReply: PrivateReplySender = sendInstagramPrivateReply,
): Promise<MetaWebhookResult> {
  const result: MetaWebhookResult = { received: 0, matched: 0, duplicates: 0, leadsCreated: 0 };
  if (payload.object !== 'instagram') return result;

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'comments') continue;
      const parsed = metaCommentChangeSchema.safeParse(change.value);
      if (!parsed.success || !parsed.data.text) continue;
      result.received += 1;
      const comment = parsed.data;
      const text = comment.text ?? '';

      const ctx = await resolveComment(entry.id, comment.media?.id);
      if (!ctx) continue;
      const rules = await db
        .select()
        .from(keywordRules)
        .where(
          and(
            eq(keywordRules.productId, ctx.productId),
            eq(keywordRules.platform, 'instagram'),
            eq(keywordRules.active, true),
          ),
        )
        .orderBy(asc(keywordRules.keyword));
      const rule = findMatchingRule(text, rules);
      if (!rule) continue;
      result.matched += 1;

      const handle = comment.from?.username ? `@${comment.from.username}` : null;
      const sourceText = `Comment "${rule.keyword}"${ctx.briefCode ? ` on ${ctx.briefCode}` : ''}, Instagram`;

      const stored = await db.transaction(async (tx) => {
        const [event] = await tx
          .insert(keywordEvents)
          .values({
            ruleId: rule.id,
            postId: ctx.postId,
            platform: 'instagram',
            externalCommentId: comment.id,
            authorHandle: handle,
            commentText: text.slice(0, 2000),
            replyStatus: 'queued',
          })
          .onConflictDoNothing()
          .returning({ id: keywordEvents.id });
        if (!event) return null; // webhook retry: already handled

        // Minimum personal data: the public handle stands in for the organisation until a person qualifies it.
        const organisation = (handle ?? 'Instagram comment').slice(0, 200);
        const [open] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(
            and(
              eq(leads.productId, ctx.productId),
              eq(leads.organisation, organisation),
              eq(leads.source, 'keyword_reply'),
              ne(leads.stage, 'won'),
              ne(leads.stage, 'lost'),
            ),
          )
          .limit(1);
        let leadId: string;
        let created = false;
        if (open) {
          leadId = open.id;
          await tx
            .insert(leadActivities)
            .values({ leadId, kind: 'note', body: `Commented again: ${sourceText}.` });
        } else {
          const [lead] = await tx
            .insert(leads)
            .values({
              productId: ctx.productId,
              organisation,
              source: 'keyword_reply',
              sourcePostId: ctx.postId,
              sourceText,
              stage: 'new',
            })
            .returning({ id: leads.id });
          leadId = lead!.id;
          created = true;
          await tx
            .insert(leadActivities)
            .values({ leadId, kind: 'note', body: `Lead created from: ${sourceText}.` });
          await writeAudit(
            {
              actorId: null,
              action: 'lead.create',
              entity: 'lead',
              entityId: leadId,
              after: { source: 'keyword_reply', ruleId: rule.id },
            },
            tx,
          );
          const [product] = await tx
            .select({ ownerId: products.ownerId, backupId: products.backupId })
            .from(products)
            .where(eq(products.id, ctx.productId));
          await notifyMany(
            [product?.ownerId, product?.backupId],
            {
              kind: 'lead_created',
              title: `New lead from keyword ${rule.keyword}`,
              body: sourceText,
              link: '/sales',
              entity: 'lead',
              entityId: leadId,
            },
            tx,
          );
        }
        await tx.update(keywordEvents).set({ leadId }).where(eq(keywordEvents.id, event.id));
        return { eventId: event.id, created };
      });

      if (!stored) {
        result.duplicates += 1;
        continue;
      }
      if (stored.created) result.leadsCreated += 1;

      // The reply goes out after the records are safe. A platform problem never loses the lead.
      let outcome: { status: KeywordReplyStatus; error: string | null };
      try {
        const reply = await sendReply({
          channelAccountId: ctx.channelAccountId,
          commentId: comment.id,
          message: buildReplyMessage(rule.replyText, ctx.trackedUrl ?? rule.link),
        });
        outcome = replyOutcome(reply);
      } catch (err) {
        logger.error({ err, eventId: stored.eventId }, 'keyword private reply threw');
        outcome = {
          status: 'queued',
          error: err instanceof Error ? err.message.slice(0, 500) : 'Reply not sent',
        };
      }
      await db
        .update(keywordEvents)
        .set({ replyStatus: outcome.status, error: outcome.error })
        .where(eq(keywordEvents.id, stored.eventId));
    }
  }
  return result;
}

/** Number of queued keyword replies per rule, for Home "Needs you". */
export async function queuedKeywordGroups(productIds: string[] | null) {
  const where: SQL[] = [eq(keywordEvents.replyStatus, 'queued')];
  if (productIds) {
    if (productIds.length === 0) return [];
    where.push(inArray(keywordRules.productId, productIds));
  }
  return db
    .select({
      ruleId: keywordRules.id,
      productId: keywordRules.productId,
      platform: keywordRules.platform,
      keyword: keywordRules.keyword,
      count: sql<string>`count(*)`.mapWith(toCount),
      since: sql<Date>`min(${keywordEvents.createdAt})`.mapWith((v: string | Date) => new Date(v)),
    })
    .from(keywordEvents)
    .innerJoin(keywordRules, eq(keywordRules.id, keywordEvents.ruleId))
    .where(and(...where))
    .groupBy(keywordRules.id);
}
