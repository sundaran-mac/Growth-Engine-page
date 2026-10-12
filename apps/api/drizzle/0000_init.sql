CREATE TYPE "public"."approval_decision" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."approval_gate" AS ENUM('claims', 'brand');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('video', 'poster', 'caption', 'cutdown');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('uploading', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."brief_kind" AS ENUM('reel', 'poster', 'short', 'carousel', 'post');--> statement-breakpoint
CREATE TYPE "public"."brief_stage" AS ENUM('idea', 'brief', 'frozen', 'made', 'reviewed', 'approved', 'scheduled', 'live');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('connected', 'needs_approval', 'manual', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."content_mode" AS ENUM('M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('file', 'url', 'repo_spec', 'note');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."idea_source" AS ENUM('claude', 'human');--> statement-breakpoint
CREATE TYPE "public"."idea_status" AS ENUM('new', 'starred', 'briefed', 'parked');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'hand_off', 'check_first', 'not_set_up', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'ta');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_kind" AS ENUM('note', 'call', 'email', 'meeting', 'stage_change');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('keyword_reply', 'tracked_link', 'dm', 'website_form', 'manual');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'qualified', 'talking', 'pilot', 'review', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('approval_requested', 'approval_escalated', 'approval_decided', 'ideas_ready', 'plan_to_freeze', 'publish_failed', 'publish_reminder', 'lead_created', 'kit_changed', 'monday_note', 'system');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'frozen');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('instagram', 'facebook', 'youtube', 'linkedin', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'scheduled', 'publishing', 'published', 'failed', 'manual_pending');--> statement-breakpoint
CREATE TYPE "public"."product_role" AS ENUM('owner', 'backup', 'maker', 'reviewer');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'in_build', 'live', 'archived');--> statement-breakpoint
CREATE TYPE "public"."render_job_kind" AS ENUM('render', 'voice', 'mix', 'cutdown', 'captions');--> statement-breakpoint
CREATE TYPE "public"."render_job_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'editor', 'member', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."weekly_run_status" AS ENUM('queued', 'running', 'done', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."weekly_run_trigger" AS ENUM('schedule', 'manual');--> statement-breakpoint
CREATE TABLE "product_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"promise" text,
	"behaviours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"never_say" text[] DEFAULT '{}'::text[] NOT NULL,
	"not_built" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audiences" text[] DEFAULT '{}'::text[] NOT NULL,
	"activation_event" text,
	"truth_sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_kits_product_version_uq" UNIQUE("product_id","version"),
	CONSTRAINT "product_kits_version_ck" CHECK ("product_kits"."version" > 0),
	CONSTRAINT "product_kits_score_ck" CHECK ("product_kits"."score" between 0 and 10),
	CONSTRAINT "product_kits_signed_ck" CHECK (("product_kits"."signed_by" is null) = ("product_kits"."signed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "product_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"product_role" "product_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_members_uq" UNIQUE("product_id","user_id","product_role")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"status_note" text,
	"color" text,
	"repo_url" text,
	"site_url" text,
	"owner_id" uuid,
	"backup_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_uq" UNIQUE("slug"),
	CONSTRAINT "products_slug_ck" CHECK ("products"."slug" ~ '^[a-z0-9][a-z0-9-]*$'),
	CONSTRAINT "products_color_ck" CHECK ("products"."color" is null or "products"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_uq" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"initials" text NOT NULL,
	"title" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"is_brand_approver" boolean DEFAULT false NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lower_ck" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_initials_ck" CHECK (char_length("users"."initials") between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "brief_code_counters" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "brief_code_counters_value_ck" CHECK ("brief_code_counters"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"kind" "brief_kind" DEFAULT 'reel' NOT NULL,
	"product_id" uuid NOT NULL,
	"idea_id" uuid,
	"title" text NOT NULL,
	"mode" "content_mode" NOT NULL,
	"stage" "brief_stage" DEFAULT 'brief' NOT NULL,
	"hook" text,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ask" text,
	"ratios" text[] DEFAULT '{}'::text[] NOT NULL,
	"caption_languages" "language"[] DEFAULT '{}' NOT NULL,
	"channels" "platform"[] DEFAULT '{}' NOT NULL,
	"owner_id" uuid,
	"claims_approver_id" uuid,
	"brand_approver_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"claim_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claude_suggestions" jsonb DEFAULT '{"captions":[],"altHooks":[],"bRoll":[],"generatedAt":null}'::jsonb NOT NULL,
	"frozen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "briefs_code_uq" UNIQUE("code"),
	CONSTRAINT "briefs_version_ck" CHECK ("briefs"."version" > 0),
	CONSTRAINT "briefs_ratios_ck" CHECK ("briefs"."ratios" <@ array['9:16','4:5','1:1','16:9']::text[]),
	CONSTRAINT "briefs_code_ck" CHECK ("briefs"."code" ~ '^[A-Z]+-[0-9]{3,}$')
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"mode" "content_mode" NOT NULL,
	"channels" "platform"[] DEFAULT '{}' NOT NULL,
	"fit_score" integer,
	"status" "idea_status" DEFAULT 'new' NOT NULL,
	"source" "idea_source" DEFAULT 'human' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_fit_score_ck" CHECK ("ideas"."fit_score" is null or "ideas"."fit_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "occasion_products" (
	"occasion_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "occasion_products_pk" PRIMARY KEY("occasion_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "occasions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occasions_dates_ck" CHECK ("occasions"."end_date" is null or "occasions"."end_date" >= "occasions"."date")
);
--> statement-breakpoint
CREATE TABLE "plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"mode" "content_mode",
	"channel" "platform",
	"idea_id" uuid,
	"brief_id" uuid,
	"occasion_id" uuid,
	"needs_shoot_slot" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_product_month_uq" UNIQUE("product_id","month"),
	CONSTRAINT "plans_month_ck" CHECK ("plans"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "plans_frozen_ck" CHECK (("plans"."status" = 'frozen') = ("plans"."frozen_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"ratio" text,
	"storage_key" text NOT NULL,
	"file_name" text,
	"mime_type" text NOT NULL,
	"size_bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"status" "asset_status" DEFAULT 'uploading' NOT NULL,
	"upload_id" text,
	"licence" text,
	"consent_on_file" boolean DEFAULT false NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"brief_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "assets_ratio_ck" CHECK ("assets"."ratio" is null or "assets"."ratio" in ('9:16','4:5','1:1','16:9')),
	CONSTRAINT "assets_size_ck" CHECK ("assets"."size_bytes" is null or "assets"."size_bytes" >= 0),
	CONSTRAINT "assets_duration_ck" CHECK ("assets"."duration_ms" is null or "assets"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "render_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"asset_id" uuid,
	"kind" "render_job_kind" NOT NULL,
	"label" text NOT NULL,
	"tool" text,
	"status" "render_job_status" DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "render_jobs_progress_ck" CHECK ("render_jobs"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"gate" "approval_gate" NOT NULL,
	"approver_id" uuid,
	"backup_id" uuid,
	"decided_by" uuid,
	"decision" "approval_decision" DEFAULT 'pending' NOT NULL,
	"note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"escalated_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_brief_version_gate_uq" UNIQUE("brief_id","version","gate"),
	CONSTRAINT "approvals_version_ck" CHECK ("approvals"."version" > 0),
	CONSTRAINT "approvals_decided_ck" CHECK (("approvals"."decision" = 'pending') = ("approvals"."decided_at" is null)),
	CONSTRAINT "approvals_changes_note_ck" CHECK ("approvals"."decision" <> 'changes_requested' or coalesce(char_length("approvals"."note"), 0) > 0)
);
--> statement-breakpoint
CREATE TABLE "review_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_checklists_brief_version_uq" UNIQUE("brief_id","version"),
	CONSTRAINT "review_checklists_version_ck" CHECK ("review_checklists"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "review_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"author_id" uuid,
	"author_label" text,
	"timecode_ms" integer,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_comments_timecode_ck" CHECK ("review_comments"."timecode_ms" is null or "review_comments"."timecode_ms" >= 0),
	CONSTRAINT "review_comments_body_ck" CHECK (char_length("review_comments"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform" NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"handle" text,
	"product_id" uuid,
	"external_account_id" text,
	"status" "channel_status" DEFAULT 'disconnected' NOT NULL,
	"allowed_actions" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"last_error" text,
	"connected_by" uuid,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_accounts_platform_external_uq" UNIQUE("platform","external_account_id"),
	CONSTRAINT "channel_accounts_actions_ck" CHECK ("channel_accounts"."allowed_actions" <@ array['publish','insights','comments','messages']::text[])
);
--> statement-breakpoint
CREATE TABLE "keyword_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"post_id" uuid,
	"platform" "platform" NOT NULL,
	"external_comment_id" text NOT NULL,
	"author_handle" text,
	"comment_text" text,
	"reply_status" text DEFAULT 'queued' NOT NULL,
	"lead_id" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_events_platform_comment_uq" UNIQUE("platform","external_comment_id"),
	CONSTRAINT "keyword_events_status_ck" CHECK ("keyword_events"."reply_status" in ('queued','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "keyword_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"keyword" text NOT NULL,
	"reply_text" text NOT NULL,
	"link" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keyword_rules_uq" UNIQUE("product_id","platform","keyword"),
	CONSTRAINT "keyword_rules_keyword_ck" CHECK ("keyword_rules"."keyword" = upper("keyword_rules"."keyword") and char_length("keyword_rules"."keyword") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reach" integer DEFAULT 0 NOT NULL,
	"saves" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"installs" integer DEFAULT 0 NOT NULL,
	"activations" integer DEFAULT 0 NOT NULL,
	"value_score" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_post_date_uq" UNIQUE("post_id","date"),
	CONSTRAINT "metric_snapshots_nonneg_ck" CHECK ("metric_snapshots"."reach" >= 0 and "metric_snapshots"."saves" >= 0 and "metric_snapshots"."shares" >= 0 and "metric_snapshots"."comments" >= 0 and "metric_snapshots"."clicks" >= 0 and "metric_snapshots"."installs" >= 0 and "metric_snapshots"."activations" >= 0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"brief_version" integer NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"asset_id" uuid,
	"format" text,
	"caption" text,
	"languages" "language"[] DEFAULT '{}' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"audience_tz" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"external_id" text,
	"live_url" text,
	"tracked_url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_scheduled_at_ck" CHECK ("posts"."status" not in ('scheduled','publishing','manual_pending') or "posts"."scheduled_at" is not null),
	CONSTRAINT "posts_published_ck" CHECK ("posts"."status" <> 'published' or "posts"."published_at" is not null),
	CONSTRAINT "posts_attempts_ck" CHECK ("posts"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" "lead_activity_kind" NOT NULL,
	"body" text,
	"from_stage" "lead_stage",
	"to_stage" "lead_stage",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_activities_stage_change_ck" CHECK ("lead_activities"."kind" <> 'stage_change' or "lead_activities"."to_stage" is not null)
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"organisation" text NOT NULL,
	"source" "lead_source" DEFAULT 'manual' NOT NULL,
	"source_post_id" uuid,
	"source_text" text,
	"who" text,
	"first_offer" text,
	"owner_id" uuid,
	"owner_note" text,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"next_step" text,
	"next_step_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_organisation_ck" CHECK (char_length("leads"."organisation") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"month" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cap_tokens" bigint NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claude_usage_product_month_uq" UNIQUE NULLS NOT DISTINCT("product_id","month"),
	CONSTRAINT "claude_usage_month_ck" CHECK ("claude_usage"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "claude_usage_nonneg_ck" CHECK ("claude_usage"."input_tokens" >= 0 and "claude_usage"."output_tokens" >= 0 and "claude_usage"."cap_tokens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "integration_status" DEFAULT 'not_set_up' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"entity" text,
	"entity_id" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"week_start" date NOT NULL,
	"body" text NOT NULL,
	"do_more" text,
	"stop_doing" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_notes_product_week_uq" UNIQUE NULLS NOT DISTINCT("product_id","week_start"),
	CONSTRAINT "weekly_notes_monday_ck" CHECK (extract(isodow from "weekly_notes"."week_start") = 1)
);
--> statement-breakpoint
CREATE TABLE "posting_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"weekday" smallint NOT NULL,
	"local_time" time NOT NULL,
	"audience_timezone" text NOT NULL,
	"label" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_slots_uq" UNIQUE("product_id","platform","weekday","local_time","audience_timezone"),
	CONSTRAINT "posting_slots_weekday_ck" CHECK ("posting_slots"."weekday" between 0 and 6)
);
--> statement-breakpoint
CREATE TABLE "product_channels" (
	"product_id" uuid NOT NULL,
	"channel_account_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"default_languages" "language"[] DEFAULT '{}' NOT NULL,
	"default_ratio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_channels_pk" PRIMARY KEY("product_id","channel_account_id"),
	CONSTRAINT "product_channels_ratio_ck" CHECK ("product_channels"."default_ratio" is null or "product_channels"."default_ratio" in ('9:16','4:5','1:1','16:9'))
);
--> statement-breakpoint
CREATE TABLE "product_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" "document_kind" NOT NULL,
	"storage_key" text,
	"source_url" text,
	"mime" text,
	"size_bytes" bigint,
	"status" "document_status" DEFAULT 'uploading' NOT NULL,
	"extracted_text" text,
	"summary" text,
	"token_estimate" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"error" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_documents_storage_key_uq" UNIQUE("storage_key"),
	CONSTRAINT "product_documents_size_ck" CHECK ("product_documents"."size_bytes" is null or "product_documents"."size_bytes" >= 0),
	CONSTRAINT "product_documents_tokens_ck" CHECK ("product_documents"."token_estimate" is null or "product_documents"."token_estimate" >= 0),
	CONSTRAINT "product_documents_source_ck" CHECK (("product_documents"."kind" <> 'file' or "product_documents"."storage_key" is not null) and ("product_documents"."kind" not in ('url','repo_spec') or "product_documents"."source_url" is not null))
);
--> statement-breakpoint
CREATE TABLE "product_settings" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"launch_date" date,
	"weekly_run_enabled" boolean DEFAULT true NOT NULL,
	"weekly_run_day" smallint DEFAULT 1 NOT NULL,
	"weekly_run_time" time DEFAULT '07:00' NOT NULL,
	"weekly_ideas_count" smallint DEFAULT 10 NOT NULL,
	"weekly_modes" text[] DEFAULT '{}'::text[] NOT NULL,
	"github_repo" text,
	"github_base_branch" text DEFAULT 'main' NOT NULL,
	"weekly_pr_enabled" boolean DEFAULT false NOT NULL,
	"approval_sla_hours" smallint DEFAULT 24 NOT NULL,
	"utm_campaign_prefix" text,
	"tracking_base_url" text,
	"claude_monthly_token_cap" integer,
	"auto_schedule" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_settings_run_day_ck" CHECK ("product_settings"."weekly_run_day" between 0 and 6),
	CONSTRAINT "product_settings_ideas_count_ck" CHECK ("product_settings"."weekly_ideas_count" between 1 and 30),
	CONSTRAINT "product_settings_sla_ck" CHECK ("product_settings"."approval_sla_hours" between 1 and 720),
	CONSTRAINT "product_settings_cap_ck" CHECK ("product_settings"."claude_monthly_token_cap" is null or "product_settings"."claude_monthly_token_cap" >= 0),
	CONSTRAINT "product_settings_modes_ck" CHECK ("product_settings"."weekly_modes" <@ array['M1','M2','M3','M4','M5','M6','M7']::text[]),
	CONSTRAINT "product_settings_github_repo_ck" CHECK ("product_settings"."github_repo" is null or "product_settings"."github_repo" ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
);
--> statement-breakpoint
CREATE TABLE "weekly_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" "weekly_run_status" DEFAULT 'queued' NOT NULL,
	"ideas_created" integer DEFAULT 0 NOT NULL,
	"note_id" uuid,
	"github_pr_url" text,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"triggered_by" "weekly_run_trigger" NOT NULL,
	"triggered_by_user" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_runs_ideas_ck" CHECK ("weekly_runs"."ideas_created" >= 0),
	CONSTRAINT "weekly_runs_manual_user_ck" CHECK ("weekly_runs"."triggered_by" = 'schedule' or "weekly_runs"."triggered_by_user" is not null)
);
--> statement-breakpoint
ALTER TABLE "product_kits" ADD CONSTRAINT "product_kits_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_kits" ADD CONSTRAINT "product_kits_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_members" ADD CONSTRAINT "product_members_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_members" ADD CONSTRAINT "product_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_backup_id_users_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_claims_approver_id_users_id_fk" FOREIGN KEY ("claims_approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_brand_approver_id_users_id_fk" FOREIGN KEY ("brand_approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_products" ADD CONSTRAINT "occasion_products_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occasion_products" ADD CONSTRAINT "occasion_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_items" ADD CONSTRAINT "plan_items_occasion_id_occasions_id_fk" FOREIGN KEY ("occasion_id") REFERENCES "public"."occasions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_frozen_by_users_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "render_jobs" ADD CONSTRAINT "render_jobs_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_backup_id_users_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_checklists" ADD CONSTRAINT "review_checklists_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_events" ADD CONSTRAINT "keyword_events_rule_id_keyword_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."keyword_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_events" ADD CONSTRAINT "keyword_events_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_events" ADD CONSTRAINT "keyword_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keyword_rules" ADD CONSTRAINT "keyword_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_post_id_posts_id_fk" FOREIGN KEY ("source_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_usage" ADD CONSTRAINT "claude_usage_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_notes" ADD CONSTRAINT "weekly_notes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting_slots" ADD CONSTRAINT "posting_slots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channels" ADD CONSTRAINT "product_channels_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_channels" ADD CONSTRAINT "product_channels_channel_account_id_channel_accounts_id_fk" FOREIGN KEY ("channel_account_id") REFERENCES "public"."channel_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_documents" ADD CONSTRAINT "product_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_settings" ADD CONSTRAINT "product_settings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_runs" ADD CONSTRAINT "weekly_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_runs" ADD CONSTRAINT "weekly_runs_note_id_weekly_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."weekly_notes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_runs" ADD CONSTRAINT "weekly_runs_triggered_by_user_users_id_fk" FOREIGN KEY ("triggered_by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_kits_signed_by_idx" ON "product_kits" USING btree ("signed_by");--> statement-breakpoint
CREATE INDEX "product_members_user_id_idx" ON "product_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "products_owner_id_idx" ON "products" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "products_backup_id_idx" ON "products" USING btree ("backup_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "briefs_product_stage_idx" ON "briefs" USING btree ("product_id","stage");--> statement-breakpoint
CREATE INDEX "briefs_idea_id_idx" ON "briefs" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "briefs_owner_id_idx" ON "briefs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "briefs_claims_approver_idx" ON "briefs" USING btree ("claims_approver_id");--> statement-breakpoint
CREATE INDEX "briefs_brand_approver_idx" ON "briefs" USING btree ("brand_approver_id");--> statement-breakpoint
CREATE INDEX "ideas_product_status_idx" ON "ideas" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "ideas_created_by_idx" ON "ideas" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "occasion_products_product_id_idx" ON "occasion_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "occasions_date_idx" ON "occasions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "plan_items_plan_date_idx" ON "plan_items" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "plan_items_idea_id_idx" ON "plan_items" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "plan_items_brief_id_idx" ON "plan_items" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "plan_items_occasion_id_idx" ON "plan_items" USING btree ("occasion_id");--> statement-breakpoint
CREATE INDEX "plans_frozen_by_idx" ON "plans" USING btree ("frozen_by");--> statement-breakpoint
CREATE INDEX "assets_brief_kind_idx" ON "assets" USING btree ("brief_id","kind");--> statement-breakpoint
CREATE INDEX "assets_status_idx" ON "assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "assets_created_by_idx" ON "assets" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "render_jobs_brief_status_idx" ON "render_jobs" USING btree ("brief_id","status");--> statement-breakpoint
CREATE INDEX "render_jobs_asset_id_idx" ON "render_jobs" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "approvals_approver_decision_idx" ON "approvals" USING btree ("approver_id","decision");--> statement-breakpoint
CREATE INDEX "approvals_backup_id_idx" ON "approvals" USING btree ("backup_id");--> statement-breakpoint
CREATE INDEX "approvals_decided_by_idx" ON "approvals" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX "approvals_pending_due_idx" ON "approvals" USING btree ("due_at") WHERE "approvals"."decision" = 'pending';--> statement-breakpoint
CREATE INDEX "review_comments_brief_version_idx" ON "review_comments" USING btree ("brief_id","version");--> statement-breakpoint
CREATE INDEX "review_comments_author_id_idx" ON "review_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "review_comments_resolved_by_idx" ON "review_comments" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "channel_accounts_product_id_idx" ON "channel_accounts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "channel_accounts_status_idx" ON "channel_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "channel_accounts_connected_by_idx" ON "channel_accounts" USING btree ("connected_by");--> statement-breakpoint
CREATE INDEX "keyword_events_rule_id_idx" ON "keyword_events" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "keyword_events_post_id_idx" ON "keyword_events" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "keyword_events_lead_id_idx" ON "keyword_events" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "metric_snapshots_date_idx" ON "metric_snapshots" USING btree ("date");--> statement-breakpoint
CREATE INDEX "posts_brief_id_idx" ON "posts" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "posts_channel_account_id_idx" ON "posts" USING btree ("channel_account_id");--> statement-breakpoint
CREATE INDEX "posts_asset_id_idx" ON "posts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "posts_status_scheduled_idx" ON "posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "lead_activities_lead_created_idx" ON "lead_activities" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_activities_actor_id_idx" ON "lead_activities" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "leads_product_stage_idx" ON "leads" USING btree ("product_id","stage");--> statement-breakpoint
CREATE INDEX "leads_source_post_id_idx" ON "leads" USING btree ("source_post_id");--> statement-breakpoint
CREATE INDEX "leads_owner_id_idx" ON "leads" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "posting_slots_product_active_idx" ON "posting_slots" USING btree ("product_id","active");--> statement-breakpoint
CREATE INDEX "product_channels_channel_account_idx" ON "product_channels" USING btree ("channel_account_id");--> statement-breakpoint
CREATE INDEX "product_documents_product_status_idx" ON "product_documents" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "product_documents_uploaded_by_idx" ON "product_documents" USING btree ("uploaded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_runs_scheduled_uq" ON "weekly_runs" USING btree ("product_id","week_start","triggered_by") WHERE "weekly_runs"."triggered_by" = 'schedule';--> statement-breakpoint
CREATE INDEX "weekly_runs_product_week_idx" ON "weekly_runs" USING btree ("product_id","week_start");--> statement-breakpoint
CREATE INDEX "weekly_runs_note_id_idx" ON "weekly_runs" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "weekly_runs_triggered_by_user_idx" ON "weekly_runs" USING btree ("triggered_by_user");