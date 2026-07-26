CREATE TYPE "public"."financial_entry_status" AS ENUM('pendente', 'pago');--> statement-breakpoint
CREATE TYPE "public"."financial_entry_type" AS ENUM('receita', 'despesa');--> statement-breakpoint
CREATE TABLE "financial_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "financial_entry_type" NOT NULL,
	"category" varchar(100) NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"due_date" date,
	"paid_date" date,
	"status" "financial_entry_status" DEFAULT 'pendente' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;