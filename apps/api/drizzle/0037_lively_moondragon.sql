ALTER TABLE "budget_sections" ADD COLUMN "template_key" varchar(50);--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "file_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "parser_version" varchar(40);--> statement-breakpoint
CREATE INDEX "plants_file_hash_idx" ON "plants" USING btree ("file_hash","parser_version");