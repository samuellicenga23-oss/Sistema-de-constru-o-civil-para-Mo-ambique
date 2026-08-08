CREATE TYPE "public"."procurement_invitation_status" AS ENUM('convidado', 'visualizado', 'respondido', 'recusado', 'expirado');--> statement-breakpoint
CREATE TYPE "public"."procurement_rfq_status" AS ENUM('rascunho', 'aberta', 'em_avaliacao', 'adjudicada', 'cancelada', 'expirada');--> statement-breakpoint
CREATE TYPE "public"."procurement_supplier_quote_status" AS ENUM('rascunho', 'submetida', 'substituida', 'retirada');--> statement-breakpoint
CREATE TYPE "public"."purchase_requisition_status" AS ENUM('rascunho', 'submetida', 'aprovada', 'em_cotacao', 'adjudicada', 'comprada', 'fechada', 'cancelada');--> statement-breakpoint
CREATE TABLE "procurement_award_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" uuid NOT NULL,
	"rfq_line_id" uuid NOT NULL,
	"quote_line_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity_awarded" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_quote_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"decision_reason" text NOT NULL,
	"awarded_by_user_id" uuid,
	"awarded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_award_quote_unique" UNIQUE("rfq_id","supplier_quote_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"year" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "procurement_document_sequence_unique" UNIQUE("company_id","kind","year")
);
--> statement-breakpoint
CREATE TABLE "procurement_rfq_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "procurement_invitation_status" DEFAULT 'convidado' NOT NULL,
	"invited_at" timestamp DEFAULT now() NOT NULL,
	"viewed_at" timestamp,
	"responded_at" timestamp,
	"declined_at" timestamp,
	CONSTRAINT "procurement_rfq_supplier_unique" UNIQUE("rfq_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_rfq_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"requisition_line_id" uuid,
	"material_id" uuid NOT NULL,
	"description" varchar(300) NOT NULL,
	"unit" varchar(20),
	"quantity" numeric(14, 3) NOT NULL,
	"specification" text,
	"required_by_date" date,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurement_rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requisition_id" uuid,
	"reference" varchar(50) NOT NULL,
	"title" varchar(240) NOT NULL,
	"message" text,
	"status" "procurement_rfq_status" DEFAULT 'rascunho' NOT NULL,
	"deadline_date" date,
	"delivery_location" text,
	"required_by_date" date,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"allow_partial_quotes" boolean DEFAULT false NOT NULL,
	"allow_partial_award" boolean DEFAULT false NOT NULL,
	"payment_requirements" text,
	"commercial_terms" text,
	"created_by_user_id" uuid,
	"opened_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_rfq_reference_unique" UNIQUE("company_id","reference")
);
--> statement-breakpoint
CREATE TABLE "procurement_supplier_quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"rfq_line_id" uuid NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"quantity_offered" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"discount_pct" numeric(7, 3) DEFAULT '0' NOT NULL,
	"brand" varchar(160),
	"lead_time_days" integer,
	"notes" text,
	CONSTRAINT "procurement_supplier_quote_line_unique" UNIQUE("quote_id","rfq_line_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_supplier_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rfq_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "procurement_supplier_quote_status" DEFAULT 'rascunho' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"valid_until" date,
	"lead_time_days" integer,
	"payment_terms" text,
	"transport_included" boolean DEFAULT true NOT NULL,
	"transport_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"supplier_notes" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_supplier_quote_version_unique" UNIQUE("rfq_id","supplier_id","version")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requisition_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"requested_qty" numeric(14, 3) NOT NULL,
	"specification" text,
	"notes" text,
	"source_schedule_task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_requisition_material_unique" UNIQUE("requisition_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"reference" varchar(50) NOT NULL,
	"status" "purchase_requisition_status" DEFAULT 'rascunho' NOT NULL,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"required_by_date" date,
	"schedule_task_id" uuid,
	"justification" text,
	"notes" text,
	"created_by_user_id" uuid,
	"submitted_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisition_reference_unique" UNIQUE("company_id","reference")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "procurement_award_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "purchase_requisition_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "transport_cost" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "procurement_award_lines" ADD CONSTRAINT "procurement_award_lines_award_id_procurement_awards_id_fk" FOREIGN KEY ("award_id") REFERENCES "public"."procurement_awards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_award_lines" ADD CONSTRAINT "procurement_award_lines_rfq_line_id_procurement_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."procurement_rfq_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_award_lines" ADD CONSTRAINT "procurement_award_lines_quote_line_id_procurement_supplier_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."procurement_supplier_quote_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_award_lines" ADD CONSTRAINT "procurement_award_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_awards" ADD CONSTRAINT "procurement_awards_rfq_id_procurement_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."procurement_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_awards" ADD CONSTRAINT "procurement_awards_supplier_quote_id_procurement_supplier_quotes_id_fk" FOREIGN KEY ("supplier_quote_id") REFERENCES "public"."procurement_supplier_quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_awards" ADD CONSTRAINT "procurement_awards_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_awards" ADD CONSTRAINT "procurement_awards_awarded_by_user_id_users_id_fk" FOREIGN KEY ("awarded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_document_sequences" ADD CONSTRAINT "procurement_document_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfq_invitations" ADD CONSTRAINT "procurement_rfq_invitations_rfq_id_procurement_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."procurement_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfq_invitations" ADD CONSTRAINT "procurement_rfq_invitations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_rfq_id_procurement_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."procurement_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_requisition_line_id_purchase_requisition_lines_id_fk" FOREIGN KEY ("requisition_line_id") REFERENCES "public"."purchase_requisition_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfq_lines" ADD CONSTRAINT "procurement_rfq_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD CONSTRAINT "procurement_rfqs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_quote_id_procurement_supplier_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."procurement_supplier_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_supplier_quote_lines" ADD CONSTRAINT "procurement_supplier_quote_lines_rfq_line_id_procurement_rfq_lines_id_fk" FOREIGN KEY ("rfq_line_id") REFERENCES "public"."procurement_rfq_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_rfq_id_procurement_rfqs_id_fk" FOREIGN KEY ("rfq_id") REFERENCES "public"."procurement_rfqs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_invitation_id_procurement_rfq_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."procurement_rfq_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_supplier_quotes" ADD CONSTRAINT "procurement_supplier_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_source_schedule_task_id_schedule_tasks_id_fk" FOREIGN KEY ("source_schedule_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_schedule_task_id_schedule_tasks_id_fk" FOREIGN KEY ("schedule_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_rfq_project_status_idx" ON "procurement_rfqs" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "procurement_supplier_quote_rfq_status_idx" ON "procurement_supplier_quotes" USING btree ("rfq_id","status");--> statement-breakpoint
CREATE INDEX "purchase_requisition_project_status_idx" ON "purchase_requisitions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_procurement_award_id_procurement_awards_id_fk" FOREIGN KEY ("procurement_award_id") REFERENCES "public"."procurement_awards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_purchase_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE set null ON UPDATE no action;