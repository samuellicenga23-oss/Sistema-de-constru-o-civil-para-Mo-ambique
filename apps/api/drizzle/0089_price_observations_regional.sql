-- Observações de preço regionais (append-only) e política de preço efectivo por empresa.

DO $$ BEGIN
  CREATE TYPE "price_observation_resource_type" AS ENUM('material', 'labour', 'equipment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "price_observation_confidence" AS ENUM('confirmed', 'estimated', 'unverified');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"resource_family_key" uuid NOT NULL,
	"resource_type" "price_observation_resource_type" NOT NULL,
	"ref_id" uuid,
	"supplier_id" uuid,
	"zone_id" uuid,
	"district_id" uuid,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"unit" "unit" NOT NULL,
	"vat_included" boolean DEFAULT false NOT NULL,
	"transport_included" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp NOT NULL,
	"source" varchar(240) NOT NULL,
	"reference" text,
	"confidence" "price_observation_confidence" DEFAULT 'estimated' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_company_family_idx" ON "price_observations" ("company_id", "resource_family_key", "resource_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_observed_at_idx" ON "price_observations" ("observed_at");
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "effective_price_policy" varchar(40) DEFAULT 'last_confirmed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "effective_price_median_n" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "price_zones"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_district_id_fk" FOREIGN KEY ("district_id") REFERENCES "mz_districts"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_created_by_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
