CREATE TABLE "supplier_equipment_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"zone_id" uuid,
	"hourly_cost" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_labour_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"labour_category_id" uuid NOT NULL,
	"zone_id" uuid,
	"hourly_cost" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_equipment_prices" ADD CONSTRAINT "supplier_equipment_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_equipment_prices" ADD CONSTRAINT "supplier_equipment_prices_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_equipment_prices" ADD CONSTRAINT "supplier_equipment_prices_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_labour_prices" ADD CONSTRAINT "supplier_labour_prices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_labour_prices" ADD CONSTRAINT "supplier_labour_prices_labour_category_id_labour_categories_id_fk" FOREIGN KEY ("labour_category_id") REFERENCES "public"."labour_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_labour_prices" ADD CONSTRAINT "supplier_labour_prices_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE cascade ON UPDATE no action;