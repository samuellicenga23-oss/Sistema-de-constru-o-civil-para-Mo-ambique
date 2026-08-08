CREATE TYPE "public"."line_item_quantity_source" AS ENUM('manual', 'measurement', 'plant', 'import', 'bim', 'estimate');--> statement-breakpoint
CREATE TYPE "public"."measurement_formula_type" AS ENUM('legacy_product', 'direct', 'count', 'length', 'area', 'wall_area', 'perimeter', 'volume', 'section_length', 'weight', 'reinforcement', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."measurement_source" AS ENUM('manual', 'plant', 'import', 'bim', 'field');--> statement-breakpoint
CREATE TABLE "composition_derived_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"basis" varchar(30) NOT NULL,
	"percentage" numeric(7, 3) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "composition_subcomposition_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"subcomposition_id" uuid NOT NULL,
	"qty_per_unit" numeric(14, 6) NOT NULL,
	"notes" text,
	CONSTRAINT "composition_subcomposition_pair_unique" UNIQUE("composition_id","subcomposition_id")
);
--> statement-breakpoint
CREATE TABLE "line_item_cost_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"composition_id" uuid,
	"composition_version" integer,
	"zone_id" uuid,
	"currency" "currency" NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"labour_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"material_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"equipment_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"subcomposition_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"derived_cost" numeric(16, 4) DEFAULT '0' NOT NULL,
	"resource_snapshot" jsonb,
	"reason" varchar(30) DEFAULT 'attached' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "measurement_certificate_field_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_line_id" uuid NOT NULL,
	"description" varchar(300) DEFAULT '' NOT NULL,
	"formula_type" "measurement_formula_type" NOT NULL,
	"sign" integer DEFAULT 1 NOT NULL,
	"count" numeric(10, 2) DEFAULT '1' NOT NULL,
	"length" numeric(12, 3),
	"width" numeric(12, 3),
	"height" numeric(12, 3),
	"direct_quantity" numeric(16, 6),
	"coefficient" numeric(16, 6) DEFAULT '1' NOT NULL,
	"unit_weight" numeric(16, 6),
	"diameter_mm" numeric(10, 3),
	"base_quantity" numeric(16, 6),
	"percentage" numeric(10, 4),
	"block" varchar(100),
	"floor" varchar(100),
	"zone" varchar(120),
	"room" varchar(160),
	"axis" varchar(120),
	"element" varchar(160),
	"evidence_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"revision_no" integer DEFAULT 1 NOT NULL,
	"supersedes_line_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "crew_size" integer;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "productive_hours_per_day" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "output_per_day" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "productivity_source" varchar(180);--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "productivity_notes" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "default_measurement_formula" "measurement_formula_type";--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "family_key" uuid;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "family_key" uuid;--> statement-breakpoint
ALTER TABLE "line_items" ADD COLUMN "quantity_source" "line_item_quantity_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "family_key" uuid;--> statement-breakpoint
UPDATE "materials" SET "family_key" = "id" WHERE "company_id" IS NULL;--> statement-breakpoint
WITH unique_global_code AS (
  SELECT "code", min("id") AS id FROM "materials"
  WHERE "company_id" IS NULL AND "code" IS NOT NULL GROUP BY "code" HAVING count(*) = 1
)
UPDATE "materials" own SET "family_key" = u.id FROM unique_global_code u
WHERE own."company_id" IS NOT NULL AND own."family_key" IS NULL AND own."code" = u."code";--> statement-breakpoint
WITH unique_global AS (
  SELECT lower(trim("name")) AS key, min("id") AS id FROM "materials"
  WHERE "company_id" IS NULL GROUP BY lower(trim("name")) HAVING count(*) = 1
)
UPDATE "materials" own SET "family_key" = u.id FROM unique_global u
WHERE own."company_id" IS NOT NULL AND own."family_key" IS NULL AND lower(trim(own."name")) = u.key;--> statement-breakpoint
UPDATE "materials" SET "family_key" = "id" WHERE "family_key" IS NULL;--> statement-breakpoint
UPDATE "labour_categories" SET "family_key" = "id" WHERE "company_id" IS NULL;--> statement-breakpoint
WITH unique_global_code AS (
  SELECT "code", min("id") AS id FROM "labour_categories"
  WHERE "company_id" IS NULL AND "code" IS NOT NULL GROUP BY "code" HAVING count(*) = 1
)
UPDATE "labour_categories" own SET "family_key" = u.id FROM unique_global_code u
WHERE own."company_id" IS NOT NULL AND own."family_key" IS NULL AND own."code" = u."code";--> statement-breakpoint
WITH unique_global AS (
  SELECT lower(trim("name")) AS key, min("id") AS id FROM "labour_categories"
  WHERE "company_id" IS NULL GROUP BY lower(trim("name")) HAVING count(*) = 1
)
UPDATE "labour_categories" own SET "family_key" = u.id FROM unique_global u
WHERE own."company_id" IS NOT NULL AND own."family_key" IS NULL AND lower(trim(own."name")) = u.key;--> statement-breakpoint
UPDATE "labour_categories" SET "family_key" = "id" WHERE "family_key" IS NULL;--> statement-breakpoint
UPDATE "equipment" SET "family_key" = "id" WHERE "company_id" IS NULL;--> statement-breakpoint
WITH unique_global AS (
  SELECT lower(trim("name")) AS key, min("id") AS id FROM "equipment"
  WHERE "company_id" IS NULL GROUP BY lower(trim("name")) HAVING count(*) = 1
)
UPDATE "equipment" own SET "family_key" = u.id FROM unique_global u
WHERE own."company_id" IS NOT NULL AND own."family_key" IS NULL AND lower(trim(own."name")) = u.key;--> statement-breakpoint
UPDATE "equipment" SET "family_key" = "id" WHERE "family_key" IS NULL;--> statement-breakpoint
ALTER TABLE "materials" ALTER COLUMN "family_key" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "materials" ALTER COLUMN "family_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ALTER COLUMN "family_key" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "labour_categories" ALTER COLUMN "family_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "family_key" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "family_key" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "materials_family_key_idx" ON "materials" USING btree ("family_key");--> statement-breakpoint
CREATE INDEX "labour_categories_family_key_idx" ON "labour_categories" USING btree ("family_key");--> statement-breakpoint
CREATE INDEX "equipment_family_key_idx" ON "equipment" USING btree ("family_key");--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "formula_type" "measurement_formula_type" DEFAULT 'legacy_product' NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "sign" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "direct_quantity" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "coefficient" numeric(16, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "unit_weight" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "diameter_mm" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "base_quantity" numeric(16, 6);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "percentage" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "block" varchar(100);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "floor" varchar(100);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "zone" varchar(120);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "room" varchar(160);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "axis" varchar(120);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "element" varchar(160);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "source" "measurement_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "source_ref" varchar(300);--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "revision_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "supersedes_line_id" uuid;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_sign_check" CHECK ("sign" IN (-1, 1));--> statement-breakpoint
ALTER TABLE "measurement_certificate_field_lines" ADD CONSTRAINT "measurement_certificate_field_sign_check" CHECK ("sign" IN (-1, 1));--> statement-breakpoint
ALTER TABLE "composition_subcomposition_lines" ADD CONSTRAINT "composition_subcomposition_not_self" CHECK ("composition_id" <> "subcomposition_id");--> statement-breakpoint
ALTER TABLE "composition_derived_cost_lines" ADD CONSTRAINT "composition_derived_cost_lines_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_subcomposition_lines" ADD CONSTRAINT "composition_subcomposition_lines_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_subcomposition_lines" ADD CONSTRAINT "composition_subcomposition_lines_subcomposition_id_cost_compositions_id_fk" FOREIGN KEY ("subcomposition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_cost_snapshots" ADD CONSTRAINT "line_item_cost_snapshots_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_cost_snapshots" ADD CONSTRAINT "line_item_cost_snapshots_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_cost_snapshots" ADD CONSTRAINT "line_item_cost_snapshots_zone_id_price_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."price_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_certificate_field_lines" ADD CONSTRAINT "measurement_certificate_field_lines_certificate_line_id_measurement_certificate_lines_id_fk" FOREIGN KEY ("certificate_line_id") REFERENCES "public"."measurement_certificate_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_certificate_field_lines" ADD CONSTRAINT "measurement_certificate_field_lines_supersedes_line_id_measurement_certificate_field_lines_id_fk" FOREIGN KEY ("supersedes_line_id") REFERENCES "public"."measurement_certificate_field_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_certificate_field_lines" ADD CONSTRAINT "measurement_certificate_field_lines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_item_cost_snapshot_item_idx" ON "line_item_cost_snapshots" USING btree ("line_item_id","created_at");--> statement-breakpoint
CREATE INDEX "measurement_certificate_field_active_idx" ON "measurement_certificate_field_lines" USING btree ("certificate_line_id","is_active","sort_order");--> statement-breakpoint
ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_supersedes_line_id_measurement_lines_id_fk" FOREIGN KEY ("supersedes_line_id") REFERENCES "public"."measurement_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "measurement_lines_active_item_idx" ON "measurement_lines" USING btree ("line_item_id","is_active","sort_order");--> statement-breakpoint
CREATE INDEX "measurement_lines_location_idx" ON "measurement_lines" USING btree ("block","floor","zone");--> statement-breakpoint
CREATE INDEX "composition_subcomposition_parent_idx" ON "composition_subcomposition_lines" USING btree ("composition_id");--> statement-breakpoint
CREATE INDEX "composition_derived_cost_parent_idx" ON "composition_derived_cost_lines" USING btree ("composition_id");