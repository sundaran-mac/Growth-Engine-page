-- Content memory (BUILD-PLAN section 11, ADR 0009). Needs the pgvector image (pgvector/pgvector:*-pg16).
-- unaccent is not needed: the app folds accents itself before it stores `normalized`.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."memory_source_type" AS ENUM('idea', 'brief_hook', 'post_caption', 'dropped_draft');--> statement-breakpoint
CREATE TABLE "content_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"source_type" "memory_source_type" NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"normalized" text NOT NULL,
	"fingerprint" text NOT NULL,
	"angle" text,
	"mode" "content_mode",
	"embedding" vector(1024),
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "angle" text;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_memory" ADD CONSTRAINT "content_memory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_memory_fingerprint_uq" ON "content_memory" USING btree ("fingerprint") WHERE "content_memory"."source_type" in ('idea', 'brief_hook');--> statement-breakpoint
CREATE UNIQUE INDEX "content_memory_source_uq" ON "content_memory" USING btree ("source_type","source_id") WHERE "content_memory"."source_id" is not null;--> statement-breakpoint
CREATE INDEX "content_memory_normalized_trgm_idx" ON "content_memory" USING gin ("normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "content_memory_embedding_hnsw_idx" ON "content_memory" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "content_memory_product_created_idx" ON "content_memory" USING btree ("product_id","created_at");