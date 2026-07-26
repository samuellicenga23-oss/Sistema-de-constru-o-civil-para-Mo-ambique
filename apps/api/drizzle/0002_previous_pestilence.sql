ALTER TABLE "companies" ADD COLUMN "working_days_per_month" integer DEFAULT 22 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "working_hours_per_day" numeric(4, 1) DEFAULT '8' NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "hourly_rate" numeric(14, 4) NOT NULL;