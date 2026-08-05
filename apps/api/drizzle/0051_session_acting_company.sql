ALTER TABLE "sessions" ADD COLUMN "acting_company_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_company_id_companies_id_fk" FOREIGN KEY ("acting_company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;
