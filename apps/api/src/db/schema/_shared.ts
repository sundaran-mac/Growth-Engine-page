/**
 * Column helpers and Postgres enums shared by every table.
 */
import { pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  APPROVAL_DECISIONS,
  APPROVAL_GATES,
  ASSET_KINDS,
  ASSET_STATUSES,
  BRIEF_KINDS,
  BRIEF_STAGES,
  CHANNEL_STATUSES,
  CONTENT_MODES,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  IDEA_SOURCES,
  IDEA_STATUSES,
  INTEGRATION_STATUSES,
  LANGUAGES,
  LEAD_ACTIVITY_KINDS,
  LEAD_SOURCES,
  LEAD_STAGES,
  MEMORY_SOURCE_TYPES,
  NOTIFICATION_KINDS,
  PLAN_STATUSES,
  PLATFORMS,
  POST_STATUSES,
  PRODUCT_ROLES,
  PRODUCT_STATUSES,
  RENDER_JOB_KINDS,
  RENDER_JOB_STATUSES,
  ROLES,
  WEEKLY_RUN_STATUSES,
  WEEKLY_RUN_TRIGGERS,
} from '@growth-desk/contract';

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

export const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const roleEnum = pgEnum('role', ROLES);
export const productRoleEnum = pgEnum('product_role', PRODUCT_ROLES);
export const productStatusEnum = pgEnum('product_status', PRODUCT_STATUSES);
export const ideaStatusEnum = pgEnum('idea_status', IDEA_STATUSES);
export const ideaSourceEnum = pgEnum('idea_source', IDEA_SOURCES);
export const contentModeEnum = pgEnum('content_mode', CONTENT_MODES);
export const planStatusEnum = pgEnum('plan_status', PLAN_STATUSES);
export const briefStageEnum = pgEnum('brief_stage', BRIEF_STAGES);
export const briefKindEnum = pgEnum('brief_kind', BRIEF_KINDS);
export const assetKindEnum = pgEnum('asset_kind', ASSET_KINDS);
export const assetStatusEnum = pgEnum('asset_status', ASSET_STATUSES);
export const renderJobKindEnum = pgEnum('render_job_kind', RENDER_JOB_KINDS);
export const renderJobStatusEnum = pgEnum('render_job_status', RENDER_JOB_STATUSES);
export const approvalGateEnum = pgEnum('approval_gate', APPROVAL_GATES);
export const approvalDecisionEnum = pgEnum('approval_decision', APPROVAL_DECISIONS);
export const platformEnum = pgEnum('platform', PLATFORMS);
export const postStatusEnum = pgEnum('post_status', POST_STATUSES);
export const channelStatusEnum = pgEnum('channel_status', CHANNEL_STATUSES);
export const leadStageEnum = pgEnum('lead_stage', LEAD_STAGES);
export const leadSourceEnum = pgEnum('lead_source', LEAD_SOURCES);
export const leadActivityKindEnum = pgEnum('lead_activity_kind', LEAD_ACTIVITY_KINDS);
export const languageEnum = pgEnum('language', LANGUAGES);
export const notificationKindEnum = pgEnum('notification_kind', NOTIFICATION_KINDS);
export const integrationStatusEnum = pgEnum('integration_status', INTEGRATION_STATUSES);
export const documentKindEnum = pgEnum('document_kind', DOCUMENT_KINDS);
export const documentStatusEnum = pgEnum('document_status', DOCUMENT_STATUSES);
export const weeklyRunStatusEnum = pgEnum('weekly_run_status', WEEKLY_RUN_STATUSES);
export const weeklyRunTriggerEnum = pgEnum('weekly_run_trigger', WEEKLY_RUN_TRIGGERS);
export const memorySourceTypeEnum = pgEnum('memory_source_type', MEMORY_SOURCE_TYPES);
