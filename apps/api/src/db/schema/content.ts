/**
 * Occasions, ideas, plans, plan items, briefs and brief code counters.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  BriefClaim,
  ClaimFlag,
  ClaudeSuggestions,
  Language,
  Platform,
  Ratio,
} from '@growth-desk/contract';
import {
  briefKindEnum,
  briefStageEnum,
  contentModeEnum,
  id,
  ideaSourceEnum,
  ideaStatusEnum,
  languageEnum,
  planStatusEnum,
  platformEnum,
  timestamps,
  tsz,
} from './_shared.js';
import { products, users } from './people.js';

export const occasions = pgTable(
  'occasions',
  {
    id: id(),
    name: text('name').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    index('occasions_date_idx').on(t.date),
    check('occasions_dates_ck', sql`${t.endDate} is null or ${t.endDate} >= ${t.date}`),
  ],
);

/** Which products an occasion applies to. */
export const occasionProducts = pgTable(
  'occasion_products',
  {
    occasionId: uuid('occasion_id')
      .notNull()
      .references(() => occasions.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ name: 'occasion_products_pk', columns: [t.occasionId, t.productId] }),
    index('occasion_products_product_id_idx').on(t.productId),
  ],
);

export const ideas = pgTable(
  'ideas',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary'),
    mode: contentModeEnum('mode').notNull(),
    channels: platformEnum('channels')
      .array()
      .$type<Platform[]>()
      .notNull()
      .default(sql`'{}'`),
    fitScore: integer('fit_score'),
    status: ideaStatusEnum('status').notNull().default('new'),
    source: ideaSourceEnum('source').notNull().default('human'),
    /** Short note on the card, for example "Needs a new cast". */
    note: text('note'),
    /** Angle tag from Claude: "audience / behaviour / twist" (content memory coverage). */
    angle: text('angle'),
    createdById: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** Soft delete: the idea leaves the board but stays in the content memory forever. */
    deletedAt: tsz('deleted_at'),
    ...timestamps(),
  },
  (t) => [
    index('ideas_product_status_idx').on(t.productId, t.status),
    index('ideas_created_by_idx').on(t.createdById),
    check('ideas_fit_score_ck', sql`${t.fitScore} is null or ${t.fitScore} between 0 and 100`),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** `YYYY-MM`. */
    month: text('month').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    frozenAt: tsz('frozen_at'),
    frozenById: uuid('frozen_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('plans_product_month_uq').on(t.productId, t.month),
    index('plans_frozen_by_idx').on(t.frozenById),
    check('plans_month_ck', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('plans_frozen_ck', sql`(${t.status} = 'frozen') = (${t.frozenAt} is not null)`),
  ],
);

export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    code: text('code').notNull().unique('briefs_code_uq'),
    kind: briefKindEnum('kind').notNull().default('reel'),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    mode: contentModeEnum('mode').notNull(),
    stage: briefStageEnum('stage').notNull().default('brief'),
    hook: text('hook'),
    beats: jsonb('beats').$type<string[]>().notNull().default([]),
    ask: text('ask'),
    ratios: text('ratios')
      .array()
      .$type<Ratio[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    captionLanguages: languageEnum('caption_languages')
      .array()
      .$type<Language[]>()
      .notNull()
      .default(sql`'{}'`),
    channels: platformEnum('channels')
      .array()
      .$type<Platform[]>()
      .notNull()
      .default(sql`'{}'`),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    claimsApproverId: uuid('claims_approver_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    brandApproverId: uuid('brand_approver_id').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    claimFlags: jsonb('claim_flags').$type<ClaimFlag[]>().notNull().default([]),
    claims: jsonb('claims').$type<BriefClaim[]>().notNull().default([]),
    claudeSuggestions: jsonb('claude_suggestions')
      .$type<ClaudeSuggestions>()
      .notNull()
      .default({ captions: [], altHooks: [], bRoll: [], generatedAt: null }),
    frozenAt: tsz('frozen_at'),
    ...timestamps(),
  },
  (t) => [
    index('briefs_product_stage_idx').on(t.productId, t.stage),
    index('briefs_idea_id_idx').on(t.ideaId),
    index('briefs_owner_id_idx').on(t.ownerId),
    index('briefs_claims_approver_idx').on(t.claimsApproverId),
    index('briefs_brand_approver_idx').on(t.brandApproverId),
    check('briefs_version_ck', sql`${t.version} > 0`),
    check('briefs_ratios_ck', sql`${t.ratios} <@ array['9:16','4:5','1:1','16:9']::text[]`),
    check('briefs_code_ck', sql`${t.code} ~ '^[A-Z]+-[0-9]{3,}$'`),
  ],
);

export const planItems = pgTable(
  'plan_items',
  {
    id: id(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    title: text('title').notNull(),
    mode: contentModeEnum('mode'),
    channel: platformEnum('channel'),
    ideaId: uuid('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
    briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
    occasionId: uuid('occasion_id').references(() => occasions.id, { onDelete: 'set null' }),
    needsShootSlot: boolean('needs_shoot_slot').notNull().default(false),
    position: integer('position').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('plan_items_plan_date_idx').on(t.planId, t.date),
    index('plan_items_idea_id_idx').on(t.ideaId),
    index('plan_items_brief_id_idx').on(t.briefId),
    index('plan_items_occasion_id_idx').on(t.occasionId),
  ],
);

/** One row per brief kind; `nextBriefCode` bumps it atomically. */
export const briefCodeCounters = pgTable(
  'brief_code_counters',
  {
    prefix: text('prefix').primaryKey(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [check('brief_code_counters_value_ck', sql`${t.lastValue} >= 0`)],
);
