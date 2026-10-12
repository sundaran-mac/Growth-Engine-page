/**
 * Channel accounts, posts, metric snapshots, keyword rules and keyword events.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ChannelAction, Language } from '@growth-desk/contract';
import {
  channelStatusEnum,
  createdAt,
  id,
  languageEnum,
  platformEnum,
  postStatusEnum,
  timestamps,
  tsz,
} from './_shared.js';
import { briefs } from './content.js';
import { assets } from './make.js';
import { products, users } from './people.js';
import { leads } from './sales.js';

export const channelAccounts = pgTable(
  'channel_accounts',
  {
    id: id(),
    platform: platformEnum('platform').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    handle: text('handle'),
    /** Null means the account is shared by every product. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    externalAccountId: text('external_account_id'),
    status: channelStatusEnum('status').notNull().default('disconnected'),
    allowedActions: text('allowed_actions')
      .array()
      .$type<ChannelAction[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** AES-256-GCM ciphertext (lib/crypto). Never sent to the web. */
    accessTokenEnc: text('access_token_enc'),
    refreshTokenEnc: text('refresh_token_enc'),
    expiresAt: tsz('expires_at'),
    lastError: text('last_error'),
    connectedById: uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
    connectedAt: tsz('connected_at'),
    ...timestamps(),
  },
  (t) => [
    unique('channel_accounts_platform_external_uq').on(t.platform, t.externalAccountId),
    index('channel_accounts_product_id_idx').on(t.productId),
    index('channel_accounts_status_idx').on(t.status),
    index('channel_accounts_connected_by_idx').on(t.connectedById),
    check(
      'channel_accounts_actions_ck',
      sql`${t.allowedActions} <@ array['publish','insights','comments','messages']::text[]`,
    ),
  ],
);

export const posts = pgTable(
  'posts',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    briefVersion: integer('brief_version').notNull(),
    channelAccountId: uuid('channel_account_id')
      .notNull()
      .references(() => channelAccounts.id, { onDelete: 'restrict' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    format: text('format'),
    caption: text('caption'),
    languages: languageEnum('languages')
      .array()
      .$type<Language[]>()
      .notNull()
      .default(sql`'{}'`),
    scheduledAt: tsz('scheduled_at'),
    /** IANA zone of the audience, for example `Asia/Kolkata`. */
    audienceTz: text('audience_tz').notNull().default('Asia/Kolkata'),
    status: postStatusEnum('status').notNull().default('draft'),
    externalId: text('external_id'),
    liveUrl: text('live_url'),
    trackedUrl: text('tracked_url'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    publishedAt: tsz('published_at'),
    ...timestamps(),
  },
  (t) => [
    index('posts_brief_id_idx').on(t.briefId),
    index('posts_channel_account_id_idx').on(t.channelAccountId),
    index('posts_asset_id_idx').on(t.assetId),
    index('posts_status_scheduled_idx').on(t.status, t.scheduledAt),
    check(
      'posts_scheduled_at_ck',
      sql`${t.status} not in ('scheduled','publishing','manual_pending') or ${t.scheduledAt} is not null`,
    ),
    check('posts_published_ck', sql`${t.status} <> 'published' or ${t.publishedAt} is not null`),
    check('posts_attempts_ck', sql`${t.attempts} >= 0`),
  ],
);

/** Daily numbers for one post on one date (values for that day, not running totals). */
export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    reach: integer('reach').notNull().default(0),
    saves: integer('saves').notNull().default(0),
    shares: integer('shares').notNull().default(0),
    comments: integer('comments').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    installs: integer('installs').notNull().default(0),
    activations: integer('activations').notNull().default(0),
    valueScore: numeric('value_score', { precision: 12, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('metric_snapshots_post_date_uq').on(t.postId, t.date),
    index('metric_snapshots_date_idx').on(t.date),
    check(
      'metric_snapshots_nonneg_ck',
      sql`${t.reach} >= 0 and ${t.saves} >= 0 and ${t.shares} >= 0 and ${t.comments} >= 0 and ${t.clicks} >= 0 and ${t.installs} >= 0 and ${t.activations} >= 0`,
    ),
  ],
);

export const keywordRules = pgTable(
  'keyword_rules',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    keyword: text('keyword').notNull(),
    replyText: text('reply_text').notNull(),
    link: text('link'),
    active: boolean('active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique('keyword_rules_uq').on(t.productId, t.platform, t.keyword),
    check(
      'keyword_rules_keyword_ck',
      sql`${t.keyword} = upper(${t.keyword}) and char_length(${t.keyword}) between 1 and 40`,
    ),
  ],
);

/** A comment that matched a keyword rule, and what happened to the reply. */
export const keywordEvents = pgTable(
  'keyword_events',
  {
    id: id(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => keywordRules.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    platform: platformEnum('platform').notNull(),
    /** Platform comment id, for de-duplication of webhook retries. */
    externalCommentId: text('external_comment_id').notNull(),
    authorHandle: text('author_handle'),
    commentText: text('comment_text'),
    replyStatus: text('reply_status').notNull().default('queued'),
    leadId: uuid('lead_id').references((): AnyPgColumn => leads.id, { onDelete: 'set null' }),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [
    unique('keyword_events_platform_comment_uq').on(t.platform, t.externalCommentId),
    index('keyword_events_rule_id_idx').on(t.ruleId),
    index('keyword_events_post_id_idx').on(t.postId),
    index('keyword_events_lead_id_idx').on(t.leadId),
    check(
      'keyword_events_status_ck',
      sql`${t.replyStatus} in ('queued','sent','failed','skipped')`,
    ),
  ],
);
