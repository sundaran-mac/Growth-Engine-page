/**
 * Users, sessions, products, product kits and product members.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { KitBehaviour, KitNotBuilt } from '@growth-desk/contract';
import {
  id,
  productRoleEnum,
  productStatusEnum,
  roleEnum,
  timestamps,
  tsz,
  createdAt,
} from './_shared.js';

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Stored lower case. Unique on lower(email) as well. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    initials: text('initials').notNull(),
    title: text('title'),
    role: roleEnum('role').notNull().default('member'),
    isBrandApprover: boolean('is_brand_approver').notNull().default(false),
    passwordHash: text('password_hash').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: tsz('last_login_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    check('users_email_lower_ck', sql`${t.email} = lower(${t.email})`),
    check('users_initials_ck', sql`char_length(${t.initials}) between 1 and 3`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256 of the cookie token. The raw token is never stored. */
    tokenHash: text('token_hash').notNull().unique('sessions_token_hash_uq'),
    expiresAt: tsz('expires_at').notNull(),
    lastSeenAt: tsz('last_seen_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    slug: text('slug').notNull().unique('products_slug_uq'),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    status: productStatusEnum('status').notNull().default('draft'),
    statusNote: text('status_note'),
    color: text('color'),
    repoUrl: text('repo_url'),
    siteUrl: text('site_url'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    backupId: uuid('backup_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('products_owner_id_idx').on(t.ownerId),
    index('products_backup_id_idx').on(t.backupId),
    check('products_slug_ck', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]*$'`),
    check('products_color_ck', sql`${t.color} is null or ${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  ],
);

export const productKits = pgTable(
  'product_kits',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    promise: text('promise'),
    behaviours: jsonb('behaviours').$type<KitBehaviour[]>().notNull().default([]),
    neverSay: text('never_say')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notBuilt: jsonb('not_built').$type<KitNotBuilt[]>().notNull().default([]),
    audiences: text('audiences')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    activationEvent: text('activation_event'),
    truthSources: text('truth_sources')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    score: integer('score').notNull().default(0),
    signedById: uuid('signed_by').references(() => users.id, { onDelete: 'set null' }),
    signedAt: tsz('signed_at'),
    ...timestamps(),
  },
  (t) => [
    unique('product_kits_product_version_uq').on(t.productId, t.version),
    index('product_kits_signed_by_idx').on(t.signedById),
    check('product_kits_version_ck', sql`${t.version} > 0`),
    check('product_kits_score_ck', sql`${t.score} between 0 and 10`),
    check('product_kits_signed_ck', sql`(${t.signedById} is null) = (${t.signedAt} is null)`),
  ],
);

export const productMembers = pgTable(
  'product_members',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productRole: productRoleEnum('product_role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_members_uq').on(t.productId, t.userId, t.productRole),
    index('product_members_user_id_idx').on(t.userId),
  ],
);
