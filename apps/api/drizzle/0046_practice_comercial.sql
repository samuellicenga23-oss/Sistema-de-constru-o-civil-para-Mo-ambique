CREATE TYPE "public"."practice_engagement_status" AS ENUM('rascunho', 'activo', 'concluido', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."practice_milestone_status" AS ENUM('pendente', 'facturado', 'pago');--> statement-breakpoint
CREATE TYPE "public"."practice_document_series_kind" AS ENUM('PRO', 'FT', 'RC');--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "phone" varchar(80);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_quote_lines" ADD COLUMN "phase" varchar(120);--> statement-breakpoint
ALTER TABLE "practice_receipts" ADD COLUMN "receipt_number" varchar(80);--> statement-breakpoint
CREATE TABLE "practice_document_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "practice_document_series_kind" NOT NULL,
	"year" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "practice_document_series_unique" UNIQUE("company_id","kind","year")
);--> statement-breakpoint
CREATE TABLE "practice_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"client_id" uuid,
	"quote_id" uuid,
	"project_id" uuid,
	"title" varchar(240) NOT NULL,
	"client_name" varchar(200) NOT NULL,
	"status" "practice_engagement_status" DEFAULT 'activo' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD COLUMN "engagement_id" uuid;--> statement-breakpoint
CREATE TABLE "practice_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"percent" numeric(5, 2),
	"amount" numeric(14, 2) NOT NULL,
	"due_date" date,
	"status" "practice_milestone_status" DEFAULT 'pendente' NOT NULL,
	"invoice_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
ALTER TABLE "practice_document_series" ADD CONSTRAINT "practice_document_series_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD CONSTRAINT "practice_engagements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD CONSTRAINT "practice_engagements_client_id_practice_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."practice_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD CONSTRAINT "practice_engagements_quote_id_practice_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."practice_quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD CONSTRAINT "practice_engagements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_engagements" ADD CONSTRAINT "practice_engagements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invoices" ADD CONSTRAINT "practice_invoices_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_milestones" ADD CONSTRAINT "practice_milestones_engagement_id_practice_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."practice_engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_milestones" ADD CONSTRAINT "practice_milestones_invoice_id_practice_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."practice_invoices"("id") ON DELETE set null ON UPDATE no action;
