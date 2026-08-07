CREATE TYPE "public"."quote_request_line_kind" AS ENUM('material', 'labour', 'equipment');--> statement-breakpoint
CREATE TYPE "public"."quote_request_status" AS ENUM('enviado', 'respondido', 'aceite', 'recusado', 'expirado', 'cancelado');--> statement-breakpoint
CREATE TABLE "quote_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"kind" "quote_request_line_kind" NOT NULL,
	"material_id" uuid,
	"labour_category_id" uuid,
	"equipment_id" uuid,
	"description" varchar(300) NOT NULL,
	"quantity" numeric(14, 3),
	"unit" varchar(20),
	"unit_cost" numeric(14, 4),
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"supplier_line_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"project_id" uuid,
	"created_by_user_id" uuid,
	"title" varchar(200) NOT NULL,
	"message" text,
	"deadline_date" date,
	"status" "quote_request_status" DEFAULT 'enviado' NOT NULL,
	"supplier_notes" text,
	"responded_at" timestamp,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" text,
	"phone" varchar(60),
	"email_verified_at" timestamp,
	"invite_token" varchar(64),
	"invite_token_expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "supplier_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_account_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "supplier_account_id" uuid;--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_quote_request_id_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_labour_category_id_labour_categories_id_fk" FOREIGN KEY ("labour_category_id") REFERENCES "public"."labour_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_request_lines" ADD CONSTRAINT "quote_request_lines_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_sessions" ADD CONSTRAINT "supplier_sessions_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;