ALTER TABLE "suppliers" ALTER COLUMN "company_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE set null ON UPDATE no action;