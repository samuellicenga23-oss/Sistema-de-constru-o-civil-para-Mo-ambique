-- Stock combustível, armazéns e movimentos com razão/odómetro.

DO $$ BEGIN
  CREATE TYPE "material_sku_type" AS ENUM('standard', 'combustivel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "warehouse_kind" AS ENUM('central', 'project', 'temporary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "sku_type" "material_sku_type" DEFAULT 'standard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "min_stock_qty" numeric(14, 3);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "warehouse_kind" DEFAULT 'project' NOT NULL,
	"name" varchar(160) NOT NULL,
	"location" varchar(240),
	"responsible_user_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouses_company_project_idx" ON "warehouses" ("company_id", "project_id");
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "reason" varchar(40);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "warehouse_id" uuid;
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "odometer_reading" numeric(14, 1);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "equipment_id" uuid;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stock_movement_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"liters" numeric(14, 3) NOT NULL,
	"odometer_reading" numeric(14, 1),
	"equipment_id" uuid,
	"ticket_ref" varchar(120),
	"photo_ref" varchar(400),
	"notes" text,
	"logged_at" date NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fuel_logs_movement_unique" ON "fuel_logs" ("stock_movement_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_responsible_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_fk" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_equipment_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_movement_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "stock_movements"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_material_fk" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_equipment_fk" FOREIGN KEY ("equipment_id") REFERENCES "equipment"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fuel_logs" ADD CONSTRAINT "fuel_logs_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
