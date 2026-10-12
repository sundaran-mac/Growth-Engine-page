/**
 * Assets and render jobs.
 */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  assetKindEnum,
  assetStatusEnum,
  id,
  renderJobKindEnum,
  renderJobStatusEnum,
  timestamps,
  tsz,
} from './_shared.js';
import { briefs } from './content.js';
import { users } from './people.js';

export const assets = pgTable(
  'assets',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull(),
    ratio: text('ratio'),
    storageKey: text('storage_key').notNull().unique('assets_storage_key_uq'),
    fileName: text('file_name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    status: assetStatusEnum('status').notNull().default('uploading'),
    /** S3 multipart upload id while a large upload is in progress. */
    uploadId: text('upload_id'),
    licence: text('licence'),
    consentOnFile: boolean('consent_on_file').notNull().default(false),
    /** AI label on by default when people are generated (doc section 09). */
    aiGenerated: boolean('ai_generated').notNull().default(false),
    /** Integrated loudness of the mix (target -14 LUFS). Entered in Studio or filled by asset.probe. */
    loudnessLufs: numeric('loudness_lufs', { precision: 4, scale: 1, mode: 'number' }),
    briefVersion: integer('brief_version').notNull().default(1),
    createdById: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    index('assets_brief_kind_idx').on(t.briefId, t.kind),
    index('assets_status_idx').on(t.status),
    index('assets_created_by_idx').on(t.createdById),
    check('assets_ratio_ck', sql`${t.ratio} is null or ${t.ratio} in ('9:16','4:5','1:1','16:9')`),
    check('assets_size_ck', sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
    check('assets_duration_ck', sql`${t.durationMs} is null or ${t.durationMs} >= 0`),
    check('assets_loudness_ck', sql`${t.loudnessLufs} is null or ${t.loudnessLufs} between -70 and 0`),
  ],
);

export const renderJobs = pgTable(
  'render_jobs',
  {
    id: id(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => briefs.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    kind: renderJobKindEnum('kind').notNull(),
    label: text('label').notNull(),
    /** Hand-off tool, for example `reel-studio`, `capcut`, `figma`. */
    tool: text('tool'),
    status: renderJobStatusEnum('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    error: text('error'),
    startedAt: tsz('started_at'),
    finishedAt: tsz('finished_at'),
    ...timestamps(),
  },
  (t) => [
    index('render_jobs_brief_status_idx').on(t.briefId, t.status),
    index('render_jobs_asset_id_idx').on(t.assetId),
    check('render_jobs_progress_ck', sql`${t.progress} between 0 and 100`),
  ],
);
