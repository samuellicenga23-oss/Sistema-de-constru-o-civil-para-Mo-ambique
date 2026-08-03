CREATE TYPE "public"."invoice_status" AS ENUM('rascunho', 'emitida', 'parcial', 'paga', 'cancelada');--> statement-breakpoint
CREATE TABLE "invoice_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"received_date" date NOT NULL,
	"reference" varchar(150),
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"measurement_certificate_id" uuid NOT NULL,
	"invoice_number" varchar(80),
	"client_name" varchar(200),
	"issue_date" date,
	"due_date" date,
	"status" "invoice_status" DEFAULT 'rascunho' NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"iva_rate" numeric(5, 4) NOT NULL,
	"retention_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"retention_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"issued_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_invoice_certificate_unique" UNIQUE("measurement_certificate_id")
);
--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_invoice_id_project_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."project_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_measurement_certificate_id_measurement_certificates_id_fk" FOREIGN KEY ("measurement_certificate_id") REFERENCES "public"."measurement_certificates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invoices" ADD CONSTRAINT "project_invoices_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;