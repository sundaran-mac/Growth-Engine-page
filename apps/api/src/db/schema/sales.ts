/**
 * Leads and lead activities. No prices are stored in the tool.
 */
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  createdAt,
  id,
  leadActivityKindEnum,
  leadSourceEnum,
  leadStageEnum,
  timestamps,
  tsz,
} from './_shared.js';
import { products, users } from './people.js';
import { posts } from './publish.js';

export const leads = pgTable(
  'leads',
  {
    id: id(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    organisation: text('organisation').notNull(),
    source: leadSourceEnum('source').notNull().default('manual'),
    sourcePostId: uuid('source_post_id').references(() => posts.id, { onDelete: 'set null' }),
    sourceText: text('source_text'),
    who: text('who'),
    firstOffer: text('first_offer'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Free text when no user owns it yet, for example "Community owner (to name)". */
    ownerNote: text('owner_note'),
    stage: leadStageEnum('stage').notNull().default('new'),
    nextStep: text('next_step'),
    nextStepAt: tsz('next_step_at'),
    ...timestamps(),
  },
  (t) => [
    index('leads_product_stage_idx').on(t.productId, t.stage),
    index('leads_source_post_id_idx').on(t.sourcePostId),
    index('leads_owner_id_idx').on(t.ownerId),
    check('leads_organisation_ck', sql`char_length(${t.organisation}) between 1 and 200`),
  ],
);

export const leadActivities = pgTable(
  'lead_activities',
  {
    id: id(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: leadActivityKindEnum('kind').notNull(),
    body: text('body'),
    fromStage: leadStageEnum('from_stage'),
    toStage: leadStageEnum('to_stage'),
    createdAt: createdAt(),
  },
  (t) => [
    index('lead_activities_lead_created_idx').on(t.leadId, t.createdAt),
    index('lead_activities_actor_id_idx').on(t.actorId),
    check(
      'lead_activities_stage_change_ck',
      sql`${t.kind} <> 'stage_change' or ${t.toStage} is not null`,
    ),
  ],
);
