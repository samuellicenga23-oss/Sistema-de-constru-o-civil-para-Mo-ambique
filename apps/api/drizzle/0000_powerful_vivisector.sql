CREATE TYPE "public"."currency" AS ENUM('MZN', 'USD');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('rascunho', 'submetido', 'aprovado');--> statement-breakpoint
CREATE TYPE "public"."line_item_kind" AS ENUM('capitulo', 'grupo', 'item', 'nota');--> statement-breakpoint
CREATE TYPE "public"."line_item_origin" AS ENUM('manual', 'planta', 'composicao');--> statement-breakpoint
CREATE TYPE "public"."plant_discipline" AS ENUM('arquitectura', 'estrutura');--> statement-breakpoint
CREATE TYPE "public"."plant_status" AS ENUM('pendente', 'processando', 'concluido', 'erro');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'activo', 'suspenso');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('m', 'm2', 'm3', 'ml', 'kg', 'un', 'vg', 'h');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin_empresa', 'orcamentista', 'engenheiro_fiscal', 'visualizador');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"revision" varchar(20),
	"file_number" varchar(50),
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"document_date" date,
	"iva_rate" numeric(5, 4) DEFAULT '0.17' NOT NULL,
	"contingencias_rate" numeric(5, 4) DEFAULT '0.10' NOT NULL,
	"status" "document_status" DEFAULT 'rascunho' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"nuit" varchar(30),
	"address" text,
	"logo_url" text,
	"default_currency" "currency" DEFAULT 'MZN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "composition_equipment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"qty_per_unit" numeric(14, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "composition_labour_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"labour_category_id" uuid NOT NULL,
	"qty_per_unit" numeric(14, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "composition_material_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"composition_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"qty_per_unit" numeric(14, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_compositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(200) NOT NULL,
	"output_unit" "unit" NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(200) NOT NULL,
	"unit" "unit" NOT NULL,
	"hourly_cost" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extracted_rebar_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plant_id" uuid NOT NULL,
	"element" varchar(100) NOT NULL,
	"diameter_mm" numeric(6, 2) NOT NULL,
	"weight_kg" numeric(12, 3) NOT NULL,
	"page" integer NOT NULL,
	"imported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "extracted_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plant_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"number" varchar(20),
	"area_m2" numeric(12, 4) NOT NULL,
	"page" integer NOT NULL,
	"imported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "labour_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(150) NOT NULL,
	"monthly_salary" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "line_item_kind" NOT NULL,
	"code" varchar(30),
	"description" text NOT NULL,
	"unit" "unit",
	"quantity" numeric(16, 4),
	"unit_price" numeric(16, 4),
	"composition_id" uuid,
	"origin" "line_item_origin" DEFAULT 'manual' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(200) NOT NULL,
	"unit" "unit" NOT NULL,
	"base_unit_cost" numeric(14, 4) NOT NULL,
	"import_factor" numeric(6, 4) DEFAULT '1.0' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_certificate_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certificate_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"cumulative_qty" numeric(16, 4) DEFAULT '0' NOT NULL,
	"period_qty" numeric(16, 4) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_document_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"period_date" date NOT NULL,
	"status" "document_status" DEFAULT 'rascunho' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"discipline" "plant_discipline" NOT NULL,
	"file_path" text NOT NULL,
	"original_file_name" varchar(300),
	"processing_status" "plant_status" DEFAULT 'pendente' NOT NULL,
	"error_message" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"client" varchar(200),
	"bairro" varchar(150),
	"talhao" varchar(100),
	"distrito" varchar(150),
	"provincia" varchar(150),
	"phase" varchar(100),
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"iva_rate" numeric(5, 4) DEFAULT '0.17' NOT NULL,
	"contingencias_rate" numeric(5, 4) DEFAULT '0.10' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"plan" varchar(50) DEFAULT 'standard' NOT NULL,
	"status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"activated_at" timestamp,
	"activated_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"name" varchar(150) NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_item_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"chapter_name" varchar(200) NOT NULL,
	"chapter_code" varchar(10),
	"description" text NOT NULL,
	"unit" "unit" NOT NULL,
	"composition_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "budget_sections" ADD CONSTRAINT "budget_sections_document_id_budget_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."budget_documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_equipment_lines" ADD CONSTRAINT "composition_equipment_lines_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_equipment_lines" ADD CONSTRAINT "composition_equipment_lines_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_labour_lines" ADD CONSTRAINT "composition_labour_lines_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_labour_lines" ADD CONSTRAINT "composition_labour_lines_labour_category_id_labour_categories_id_fk" FOREIGN KEY ("labour_category_id") REFERENCES "public"."labour_categories"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_material_lines" ADD CONSTRAINT "composition_material_lines_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "composition_material_lines" ADD CONSTRAINT "composition_material_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_compositions" ADD CONSTRAINT "cost_compositions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extracted_rebar_schedules" ADD CONSTRAINT "extracted_rebar_schedules_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "extracted_rooms" ADD CONSTRAINT "extracted_rooms_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "labour_categories" ADD CONSTRAINT "labour_categories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_section_id_budget_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."budget_sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_parent_id_line_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_certificate_lines" ADD CONSTRAINT "measurement_certificate_lines_certificate_id_measurement_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."measurement_certificates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_certificate_lines" ADD CONSTRAINT "measurement_certificate_lines_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_budget_document_id_budget_documents_id_fk" FOREIGN KEY ("budget_document_id") REFERENCES "public"."budget_documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plants" ADD CONSTRAINT "plants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_item_templates" ADD CONSTRAINT "work_item_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_item_templates" ADD CONSTRAINT "work_item_templates_composition_id_cost_compositions_id_fk" FOREIGN KEY ("composition_id") REFERENCES "public"."cost_compositions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
