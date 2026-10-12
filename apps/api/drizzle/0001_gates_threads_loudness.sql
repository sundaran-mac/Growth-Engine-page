ALTER TABLE "assets" ADD COLUMN "loudness_lufs" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "review_comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_parent_id_review_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."review_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_comments_parent_id_idx" ON "review_comments" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_loudness_ck" CHECK ("assets"."loudness_lufs" is null or "assets"."loudness_lufs" between -70 and 0);