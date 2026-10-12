/**
 * Audit log, notifications, Claude usage, integrations and weekly (Monday) notes.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  id,
  integrationStatusEnum,
  notificationKindEnum,
  timestamps,
  tsz,
} from './_shared.js';
import { products, users } from './people.js';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dotted verb, for example `brief.freeze`, `approval.decide`, `auth.login`. */
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entity, t.entityId),
    index('audit_logs_actor_id_idx').on(t.actorId),
    index('audit_logs_created_at_idx').on(t.createdAt),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    entity: text('entity'),
    entityId: text('entity_id'),
    readAt: tsz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_unread_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export const claudeUsage = pgTable(
  'claude_usage',
  {
    id: id(),
    /** Null for calls not tied to one product. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    capTokens: bigint('cap_tokens', { mode: 'number' }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    unique('claude_usage_product_month_uq').on(t.productId, t.month).nullsNotDistinct(),
    check('claude_usage_month_ck', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'claude_usage_nonneg_ck',
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.capTokens} >= 0`,
    ),
  ],
);

/** Non-channel integrations listed on the Integrations screen. */
export const integrations = pgTable('integrations', {
  id: id(),
  key: text('key').notNull().unique('integrations_key_uq'),
  name: text('name').notNull(),
  description: text('description'),
  status: integrationStatusEnum('status').notNull().default('not_set_up'),
  ...timestamps(),
});

/** The Monday learning note (Claude writes it, people read it). */
export const weeklyNotes = pgTable(
  'weekly_notes',
  {
    id: id(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    body: text('body').notNull(),
    doMore: text('do_more'),
    stopDoing: text('stop_doing'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('weekly_notes_product_week_uq').on(t.productId, t.weekStart).nullsNotDistinct(),
    check('weekly_notes_monday_ck', sql`extract(isodow from ${t.weekStart}) = 1`),
  ],
);
