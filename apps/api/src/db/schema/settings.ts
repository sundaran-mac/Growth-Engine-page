/**
 * Per-product settings, posting slots, product channels, product documents and weekly runs.
 * Weekdays follow JavaScript `Date.getDay()`: 0 = Sunday, 1 = Monday ... 6 = Saturday.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ContentMode, Language, Ratio } from '@growth-desk/contract';
import {
  documentKindEnum,
  documentStatusEnum,
  id,
  languageEnum,
  platformEnum,
  timestamps,
  tsz,
  weeklyRunStatusEnum,
  weeklyRunTriggerEnum,
} from './_shared.js';
import { products, users } from './people.js';
import { channelAccounts } from './publish.js';
import { weeklyNotes } from './system.js';

/** One row per product. */
export const productSettings = pgTable(
  'product_settings',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    /** First public post day. */
    launchDate: date('launch_date', { mode: 'string' }),
    weeklyRunEnabled: boolean('weekly_run_enabled').notNull().default(true),
    weeklyRunDay: smallint('weekly_run_day').notNull().default(1),
    /** Local `HH:mm:ss` in `timezone`. */
    weeklyRunTime: time('weekly_run_time').notNull().default('07:00'),
    weeklyIdeasCount: smallint('weekly_ideas_count').notNull().default(10),
    /** Content modes to include; empty means all modes. */
    weeklyModes: text('weekly_modes')
      .array()
      .$type<ContentMode[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** `owner/name`. */
    githubRepo: text('github_repo'),
    githubBaseBranch: text('github_base_branch').notNull().default('main'),
    weeklyPrEnabled: boolean('weekly_pr_enabled').notNull().default(false),
    approvalSlaHours: smallint('approval_sla_hours').notNull().default(24),
    utmCampaignPrefix: text('utm_campaign_prefix'),
    trackingBaseUrl: text('tracking_base_url'),
    /** Null means use CLAUDE_MONTHLY_TOKEN_CAP. */
    claudeMonthlyTokenCap: integer('claude_monthly_token_cap'),
    /** Approved posts take the next free posting slot. */
    autoSchedule: boolean('auto_schedule').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check('product_settings_run_day_ck', sql`${t.weeklyRunDay} between 0 and 6`),
    check('product_settings_ideas_count_ck', sql`${t.weeklyIdeasCount} between 1 and 30`),
    check('product_settings_sla_ck', sql`${t.approvalSlaHours} between 1 and 720`),
    check(
      'product_settings_cap_ck',
      sql`${t.claudeMonthlyTokenCap} is null or ${t.claudeMonthlyTokenCap} >= 0`,
    ),
    check(
      'product_settings_modes_ck',
      sql`${t.weeklyModes} <@ array['M1','M2','M3','M4','M5','M6','M7']::text[]`,
    ),
    check(
      'product_settings_github_repo_ck',
      sql`${t.githubRepo} is null or ${t.githubRepo} ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'`,
    ),
  ],
);

/** Weekly posting windows per product and platform, in the audience's local time. */
export const postingSlots = pgTable(
  'posting_slots',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    platform: platformEnum('platform').notNull(),
    weekday: smallint('weekday').notNull(),
    localTime: time('local_time').notNull(),
    audienceTimezone: text('audience_timezone').notNull(),
    label: text('label'),
    active: boolean('active').notNull().default(true),
    sort: smallint('sort').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('posting_slots_uq').on(
      t.productId,
      t.platform,
      t.weekday,
      t.localTime,
      t.audienceTimezone,
    ),
    index('posting_slots_product_active_idx').on(t.productId, t.active),
    check('posting_slots_weekday_ck', sql`${t.weekday} between 0 and 6`),
  ],
);

/** Which channel accounts a product posts to, with its defaults. */
export const productChannels = pgTable(
  'product_channels',
  {
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    channelAccountId: uuid('channel_account_id')
      .notNull()
      .references(() => channelAccounts.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    defaultLanguages: languageEnum('default_languages')
      .array()
      .$type<Language[]>()
      .notNull()
      .default(sql`'{}'`),
    defaultRatio: text('default_ratio').$type<Ratio>(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: 'product_channels_pk', columns: [t.productId, t.channelAccountId] }),
    index('product_channels_channel_account_idx').on(t.channelAccountId),
    check(
      'product_channels_ratio_ck',
      sql`${t.defaultRatio} is null or ${t.defaultRatio} in ('9:16','4:5','1:1','16:9')`,
    ),
  ],
);

/** Files, links and notes Claude reads for a product (the truth beyond the kit). */
export const productDocuments = pgTable(
  'product_documents',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: documentKindEnum('kind').notNull(),
    storageKey: text('storage_key').unique('product_documents_storage_key_uq'),
    sourceUrl: text('source_url'),
    mimeType: text('mime'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    status: documentStatusEnum('status').notNull().default('uploading'),
    extractedText: text('extracted_text'),
    /** Claude summary. */
    summary: text('summary'),
    tokenEstimate: integer('token_estimate'),
    pinned: boolean('pinned').notNull().default(false),
    error: text('error'),
    uploadedById: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('product_documents_product_status_idx').on(t.productId, t.status),
    index('product_documents_uploaded_by_idx').on(t.uploadedById),
    check('product_documents_size_ck', sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
    check(
      'product_documents_tokens_ck',
      sql`${t.tokenEstimate} is null or ${t.tokenEstimate} >= 0`,
    ),
    check(
      'product_documents_source_ck',
      sql`(${t.kind} <> 'file' or ${t.storageKey} is not null) and (${t.kind} not in ('url','repo_spec') or ${t.sourceUrl} is not null)`,
    ),
  ],
);

/** One row per weekly (Monday) run. Scheduled runs are unique per product and week. */
export const weeklyRuns = pgTable(
  'weekly_runs',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    status: weeklyRunStatusEnum('status').notNull().default('queued'),
    ideasCreated: integer('ideas_created').notNull().default(0),
    noteId: uuid('note_id').references(() => weeklyNotes.id, { onDelete: 'set null' }),
    githubPrUrl: text('github_pr_url'),
    error: text('error'),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    triggeredBy: weeklyRunTriggerEnum('triggered_by').notNull(),
    triggeredByUserId: uuid('triggered_by_user').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('weekly_runs_scheduled_uq')
      .on(t.productId, t.weekStart, t.triggeredBy)
      .where(sql`${t.triggeredBy} = 'schedule'`),
    index('weekly_runs_product_week_idx').on(t.productId, t.weekStart),
    index('weekly_runs_note_id_idx').on(t.noteId),
    index('weekly_runs_triggered_by_user_idx').on(t.triggeredByUserId),
    check('weekly_runs_ideas_ck', sql`${t.ideasCreated} >= 0`),
    check(
      'weekly_runs_manual_user_ck',
      sql`${t.triggeredBy} = 'schedule' or ${t.triggeredByUserId} is not null`,
    ),
  ],
);
