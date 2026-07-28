ALTER TABLE "plants" ADD COLUMN "processing_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "processing_stage" varchar(200);--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "processing_current_page" integer;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "processing_total_pages" integer;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "processing_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "plants" ADD COLUMN "processing_updated_at" timestamp DEFAULT now() NOT NULL;