/**
 * Review checklists, review comments and approvals (the two human gates).
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ChecklistItem } from '@growth-desk/contract';
import { approvalDecisionEnum, approvalGateEnum, id, timestamps, tsz } from './_shared.js';
import { briefs } from './content.js';
import { users } from './people.js';

export const reviewChecklists = pgTable(
  'review_checklists',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    items: jsonb('items').$type<ChecklistItem[]>().notNull().default([]),
    completedAt: tsz('completed_at'),
    ...timestamps(),
  },
  (t) => [
    unique('review_checklists_brief_version_uq').on(t.briefId, t.version),
    check('review_checklists_version_ck', sql`${t.version} > 0`),
  ],
);

export const reviewComments = pgTable(
  'review_comments',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Display label such as "Testing" or "Live owner" (shown on the Review screen). */
    authorLabel: text('author_label'),
    timecodeMs: integer('timecode_ms'),
    /** Reply thread: the comment this one answers (one level deep). */
    parentId: uuid('parent_id').references((): AnyPgColumn => reviewComments.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedById: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: tsz('resolved_at'),
    ...timestamps(),
  },
  (t) => [
    index('review_comments_brief_version_idx').on(t.briefId, t.version),
    index('review_comments_author_id_idx').on(t.authorId),
    index('review_comments_parent_id_idx').on(t.parentId),
    index('review_comments_resolved_by_idx').on(t.resolvedById),
    check('review_comments_timecode_ck', sql`${t.timecodeMs} is null or ${t.timecodeMs} >= 0`),
    check('review_comments_body_ck', sql`char_length(${t.body}) between 1 and 4000`),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    /** Brief version this decision is for. A newer brief version makes it stale. */
    version: integer('version').notNull(),
    gate: approvalGateEnum('gate').notNull(),
    approverId: uuid('approver_id').references(() => users.id, { onDelete: 'set null' }),
    backupId: uuid('backup_id').references(() => users.id, { onDelete: 'set null' }),
    decidedById: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decision: approvalDecisionEnum('decision').notNull().default('pending'),
    note: text('note'),
    requestedAt: tsz('requested_at').notNull().defaultNow(),
    dueAt: tsz('due_at').notNull(),
    escalatedAt: tsz('escalated_at'),
    decidedAt: tsz('decided_at'),
    ...timestamps(),
  },
  (t) => [
    unique('approvals_brief_version_gate_uq').on(t.briefId, t.version, t.gate),
    index('approvals_approver_decision_idx').on(t.approverId, t.decision),
    index('approvals_backup_id_idx').on(t.backupId),
    index('approvals_decided_by_idx').on(t.decidedById),
    index('approvals_pending_due_idx')
      .on(t.dueAt)
      .where(sql`${t.decision} = 'pending'`),
    check('approvals_version_ck', sql`${t.version} > 0`),
    check('approvals_decided_ck', sql`(${t.decision} = 'pending') = (${t.decidedAt} is null)`),
    check(
      'approvals_changes_note_ck',
      sql`${t.decision} <> 'changes_requested' or coalesce(char_length(${t.note}), 0) > 0`,
    ),
  ],
);
