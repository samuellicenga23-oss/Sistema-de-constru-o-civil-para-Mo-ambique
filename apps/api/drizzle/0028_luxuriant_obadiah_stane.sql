CREATE TABLE "project_material_specifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"specification" text,
	"source" varchar(40) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_material_specifications_project_id_material_id_unique" UNIQUE("project_id","material_id")
);
--> statement-breakpoint
ALTER TABLE "budget_documents" ADD COLUMN "site_costs_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD COLUMN "profit_margin_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "measurement_mode" varchar(20) DEFAULT 'plantas' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "site_costs_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "profit_margin_rate" numeric(5, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_material_specifications" ADD CONSTRAINT "project_material_specifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_material_specifications" ADD CONSTRAINT "project_material_specifications_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;