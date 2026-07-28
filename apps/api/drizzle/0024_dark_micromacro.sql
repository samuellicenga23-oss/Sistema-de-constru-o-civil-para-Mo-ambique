ALTER TABLE "composition_equipment_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "composition_labour_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "composition_material_lines" ADD COLUMN "waste_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "composition_material_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "measurement_criteria" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "execution_notes" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "auxiliary_cost_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "indirect_cost_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "profit_margin_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "source_name" varchar(180);--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_compositions" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "productive_hours_per_month" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "social_charges_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "complementary_costs_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "source_name" varchar(180);--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "labour_categories" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "source_name" varchar(180);--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "includes_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "transport_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "material_zone_prices" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "code" varchar(50);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "category" varchar(100) DEFAULT 'Outros' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "specification" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "default_waste_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "price_source_name" varchar(180);--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "price_date" date;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "includes_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "materials" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "province" varchar(100);--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "district" varchar(100);--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "material_adjustment_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "labour_adjustment_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "equipment_adjustment_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "default_transport_pct" numeric(7, 3) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "source_name" varchar(180);--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "source_reference" text;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "effective_date" date;--> statement-breakpoint
ALTER TABLE "price_zones" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;