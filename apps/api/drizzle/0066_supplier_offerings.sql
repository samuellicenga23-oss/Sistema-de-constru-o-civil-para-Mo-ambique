-- Oferta do fornecedor marketplace (o que vende) + produtos seleccionados no catálogo.
ALTER TABLE "suppliers" ADD COLUMN "offers_materials" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "offers_labour" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "offers_equipment" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "materials" ADD COLUMN "created_by_supplier_account_id" uuid;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "created_by_supplier_account_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment" ADD COLUMN "created_by_supplier_account_id" uuid;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_created_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("created_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD CONSTRAINT "labour_categories_created_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("created_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_created_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("created_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "supplier_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"material_id" uuid,
	"labour_category_id" uuid,
	"equipment_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_labour_category_id_labour_categories_id_fk" FOREIGN KEY ("labour_category_id") REFERENCES "public"."labour_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_catalog_material_uidx" ON "supplier_catalog_items" ("supplier_id","material_id") WHERE "material_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_catalog_labour_uidx" ON "supplier_catalog_items" ("supplier_id","labour_category_id") WHERE "labour_category_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_catalog_equipment_uidx" ON "supplier_catalog_items" ("supplier_id","equipment_id") WHERE "equipment_id" IS NOT NULL;--> statement-breakpoint

-- Backfill: quem já tem preços mantém essa oferta e os produtos precificados.
UPDATE "suppliers" SET "offers_materials" = true
WHERE "id" IN (SELECT DISTINCT "supplier_id" FROM "supplier_material_prices");--> statement-breakpoint
UPDATE "suppliers" SET "offers_labour" = true
WHERE "id" IN (SELECT DISTINCT "supplier_id" FROM "supplier_labour_prices");--> statement-breakpoint
UPDATE "suppliers" SET "offers_equipment" = true
WHERE "id" IN (SELECT DISTINCT "supplier_id" FROM "supplier_equipment_prices");--> statement-breakpoint

INSERT INTO "supplier_catalog_items" ("supplier_id", "kind", "material_id")
SELECT DISTINCT p."supplier_id", 'material', p."material_id"
FROM "supplier_material_prices" p
WHERE NOT EXISTS (
  SELECT 1 FROM "supplier_catalog_items" i
  WHERE i."supplier_id" = p."supplier_id" AND i."material_id" = p."material_id"
);--> statement-breakpoint
INSERT INTO "supplier_catalog_items" ("supplier_id", "kind", "labour_category_id")
SELECT DISTINCT p."supplier_id", 'labour', p."labour_category_id"
FROM "supplier_labour_prices" p
WHERE NOT EXISTS (
  SELECT 1 FROM "supplier_catalog_items" i
  WHERE i."supplier_id" = p."supplier_id" AND i."labour_category_id" = p."labour_category_id"
);--> statement-breakpoint
INSERT INTO "supplier_catalog_items" ("supplier_id", "kind", "equipment_id")
SELECT DISTINCT p."supplier_id", 'equipment', p."equipment_id"
FROM "supplier_equipment_prices" p
WHERE NOT EXISTS (
  SELECT 1 FROM "supplier_catalog_items" i
  WHERE i."supplier_id" = p."supplier_id" AND i."equipment_id" = p."equipment_id"
);
