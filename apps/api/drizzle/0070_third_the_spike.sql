CREATE TABLE "project_schedule_planning_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_document_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"profile" jsonb NOT NULL,
	"profile_fingerprint" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"last_preview_fingerprint" varchar(64),
	"last_preview_start_date" date,
	"previewed_at" timestamp,
	"generated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_schedule_planning_profile_unique" UNIQUE("project_id","budget_document_id")
);
--> statement-breakpoint
ALTER TABLE "project_schedule_planning_profiles" ADD CONSTRAINT "project_schedule_planning_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_schedule_planning_profiles" ADD CONSTRAINT "project_schedule_planning_profiles_budget_document_id_budget_documents_id_fk" FOREIGN KEY ("budget_document_id") REFERENCES "public"."budget_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_schedule_planning_profile_document_idx" ON "project_schedule_planning_profiles" USING btree ("budget_document_id");