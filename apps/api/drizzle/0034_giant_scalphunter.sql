CREATE TYPE "public"."contract_status" AS ENUM('rascunho', 'activo', 'concluido', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."contract_variation_status" AS ENUM('rascunho', 'submetida', 'aprovada', 'rejeitada');--> statement-breakpoint
CREATE TABLE "contract_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"status" "contract_variation_status" DEFAULT 'rascunho' NOT NULL,
	"submitted_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"decision_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_number" varchar(100) NOT NULL,
	"client_name" varchar(200) NOT NULL,
	"award_date" date,
	"start_date" date,
	"end_date" date,
	"original_amount" numeric(14, 2) NOT NULL,
	"advance_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"retention_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"status" "contract_status" DEFAULT 'rascunho' NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_contracts_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_contract_id_project_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."project_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contracts" ADD CONSTRAINT "project_contracts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;