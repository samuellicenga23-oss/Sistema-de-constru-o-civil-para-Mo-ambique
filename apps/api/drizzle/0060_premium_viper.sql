CREATE TYPE "public"."commercial_lead_status" AS ENUM('novo', 'contactado', 'resolvido');--> statement-breakpoint
CREATE TABLE "commercial_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"source" varchar(40) NOT NULL,
	"name" varchar(150) NOT NULL,
	"company" varchar(200),
	"email" varchar(200) NOT NULL,
	"phone" varchar(60),
	"nuit" varchar(50),
	"city" varchar(150),
	"team_size" varchar(60),
	"plan_or_pack" varchar(100),
	"billing_cycle" varchar(20),
	"notes" text,
	"status" "commercial_lead_status" DEFAULT 'novo' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commercial_leads" ADD CONSTRAINT "commercial_leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commercial_leads_status_idx" ON "commercial_leads" USING btree ("status","created_at");