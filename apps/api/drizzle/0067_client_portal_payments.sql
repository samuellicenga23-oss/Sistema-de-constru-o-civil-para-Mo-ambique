CREATE TYPE "public"."client_payment_plan_mode" AS ENUM('total', 'parcelado');--> statement-breakpoint
CREATE TYPE "public"."client_payment_installment_status" AS ENUM('prevista', 'parcial', 'paga');--> statement-breakpoint

CREATE TABLE "project_client_share_settings" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"show_progress" boolean DEFAULT true NOT NULL,
	"show_certified_value" boolean DEFAULT true NOT NULL,
	"show_contract_value" boolean DEFAULT true NOT NULL,
	"show_schedule" boolean DEFAULT true NOT NULL,
	"show_current_phase" boolean DEFAULT true NOT NULL,
	"show_diary_evidences" boolean DEFAULT true NOT NULL,
	"show_payment_schedule" boolean DEFAULT true NOT NULL,
	"show_next_payment" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_client_share_settings" ADD CONSTRAINT "project_client_share_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "project_client_payment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" "client_payment_plan_mode" DEFAULT 'parcelado' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_client_payment_plans_project_id_unique" UNIQUE("project_id")
);--> statement-breakpoint
ALTER TABLE "project_client_payment_plans" ADD CONSTRAINT "project_client_payment_plans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "project_client_payment_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"sequence" integer DEFAULT 1 NOT NULL,
	"title" varchar(200) NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "client_payment_installment_status" DEFAULT 'prevista' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_at" date,
	"invoice_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_client_payment_installments" ADD CONSTRAINT "project_client_payment_installments_plan_id_project_client_payment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."project_client_payment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_client_payment_installments" ADD CONSTRAINT "project_client_payment_installments_invoice_id_project_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."project_invoices"("id") ON DELETE set null ON UPDATE no action;
