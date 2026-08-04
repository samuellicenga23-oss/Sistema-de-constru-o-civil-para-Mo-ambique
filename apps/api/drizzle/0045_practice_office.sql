CREATE TYPE "public"."practice_quote_status" AS ENUM('rascunho', 'enviada', 'aprovada', 'rejeitada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."practice_invoice_status" AS ENUM('rascunho', 'emitida', 'parcial', 'paga', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."practice_destination_kind" AS ENUM('caixa', 'terceiro');--> statement-breakpoint
CREATE TABLE "practice_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"contact" varchar(200),
	"email" varchar(200),
	"nuit" varchar(50),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid,
	"project_id" uuid,
	"title" varchar(240) NOT NULL,
	"client_name" varchar(200) NOT NULL,
	"status" "practice_quote_status" DEFAULT 'rascunho' NOT NULL,
	"quote_number" varchar(80),
	"issue_date" date,
	"valid_until" date,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"notes" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_by_user_id" uuid,
	"approved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_quote_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" varchar(20) DEFAULT 'un' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"quote_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"invoice_number" varchar(80),
	"client_name" varchar(200) NOT NULL,
	"status" "practice_invoice_status" DEFAULT 'rascunho' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"gross_amount" numeric(14, 2) NOT NULL,
	"iva_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "practice_invoice_number_unique" UNIQUE("company_id","invoice_number")
);--> statement-breakpoint
CREATE TABLE "practice_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '1' NOT NULL,
	"unit" varchar(20) DEFAULT 'un' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"received_date" date NOT NULL,
	"reference" varchar(150),
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "practice_receipt_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"kind" "practice_destination_kind" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"party_name" varchar(200),
	"description" text,
	"paid_at" date
);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD CONSTRAINT "practice_clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD CONSTRAINT "practice_quotes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD CONSTRAINT "practice_quotes_client_id_practice_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."practice_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD CONSTRAINT "practice_quotes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD CONSTRAINT "practice_quotes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD CONSTRAINT "practice_quote_lines_quote_id_practice_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."practice_quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_quote_id_practice_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."practice_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_client_id_practice_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."practice_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoice_lines" ADD CONSTRAINT "practice_invoice_lines_invoice_id_practice_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."practice_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_receipts" ADD CONSTRAINT "practice_receipts_invoice_id_practice_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."practice_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_receipts" ADD CONSTRAINT "practice_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_receipts" ADD CONSTRAINT "practice_receipts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_receipt_destinations" ADD CONSTRAINT "practice_receipt_destinations_receipt_id_practice_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."practice_receipts"("id") ON DELETE cascade ON UPDATE no action;
