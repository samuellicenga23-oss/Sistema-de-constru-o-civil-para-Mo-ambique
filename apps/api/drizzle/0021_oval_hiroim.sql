ALTER TABLE "companies" ADD COLUMN "province" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "district" varchar(100);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "phone" varchar(50);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "email" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "website" varchar(200);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "bank_details" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "document_footer" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "responsible_name" varchar(150);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_language" varchar(10) DEFAULT 'pt' NOT NULL;