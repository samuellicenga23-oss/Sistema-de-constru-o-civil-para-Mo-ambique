ALTER TABLE "practice_quotes" ADD COLUMN "source_budget_document_id" uuid;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "service_category" varchar(40);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "service_type" varchar(80);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "pricing_mode" varchar(40) DEFAULT 'por_fase';--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "project_designation" varchar(240);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "work_type" varchar(120);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "location" varchar(240);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "owner_name" varchar(200);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "estimated_area" varchar(80);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "floors" varchar(40);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "project_description" text;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "observations" text;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "planned_start_date" date;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "client_deadline" varchar(120);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "conditions" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD COLUMN "specialty" varchar(120);--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD COLUMN "included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD COLUMN "optional" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD COLUMN "duration_days" integer;
