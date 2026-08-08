ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "floors" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD COLUMN IF NOT EXISTS "value_share" numeric(6, 4) DEFAULT '1' NOT NULL;
