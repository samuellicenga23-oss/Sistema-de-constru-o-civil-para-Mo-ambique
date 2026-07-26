CREATE TABLE IF NOT EXISTS "material_zone_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(100) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_zone_prices" ADD CONSTRAINT "material_zone_prices_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material_zone_prices" ADD CONSTRAINT "material_zone_prices_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_zones" ADD CONSTRAINT "price_zones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
