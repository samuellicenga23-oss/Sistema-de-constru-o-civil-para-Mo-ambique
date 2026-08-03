ALTER TABLE "companies" ADD COLUMN "enabled_modules" jsonb DEFAULT '["dashboard","measurements","budgets","catalog","suppliers","purchasing","schedule","site_diary","financial","quick_calculations"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "brand_name" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "primary_color" varchar(7) DEFAULT '#1AADB4' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "accent_color" varchar(7) DEFAULT '#ED6C22' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "default_language" varchar(10) DEFAULT 'pt' NOT NULL;