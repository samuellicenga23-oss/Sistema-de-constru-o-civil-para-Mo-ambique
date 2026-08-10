CREATE TYPE "public"."plant_review_status" AS ENUM('aberto', 'em_analise', 'resolvido');--> statement-breakpoint
CREATE TYPE "public"."plant_review_reason" AS ENUM('erro_processamento', 'extraccao_incompleta', 'pedido_utilizador');--> statement-breakpoint
CREATE TABLE "plant_review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"reason" "plant_review_reason" NOT NULL,
	"status" "plant_review_status" DEFAULT 'aberto' NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress_at_failure" integer,
	"error_message" text,
	"user_notes" text,
	"admin_notes" text,
	"sla_hours" integer DEFAULT 5 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "plant_review_requests" ADD CONSTRAINT "plant_review_requests_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_review_requests" ADD CONSTRAINT "plant_review_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_review_requests" ADD CONSTRAINT "plant_review_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_review_requests" ADD CONSTRAINT "plant_review_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plant_review_requests_status_idx" ON "plant_review_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "plant_review_requests_plant_idx" ON "plant_review_requests" USING btree ("plant_id","status");
