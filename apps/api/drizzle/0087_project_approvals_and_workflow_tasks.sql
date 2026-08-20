-- Equipa da obra + rotas de aprovação por projecto + caixa de acções (workflow tasks).
-- Não destrutivo: projectos sem configuração continuam no fallback empresa/legacy.

CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_role" varchar(40) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approval_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_type" varchar(40) NOT NULL,
	"approval_mode" varchar(20) DEFAULT 'any' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"minimum_approvals" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_approval_step_users" (
	"step_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "project_approval_step_users_pk" PRIMARY KEY("step_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"workflow_type" varchar(40) NOT NULL,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid NOT NULL,
	"assigned_user_id" uuid NOT NULL,
	"step_order" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"kind" varchar(30) DEFAULT 'approval' NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text,
	"link" text,
	"project_name_snapshot" varchar(200),
	"requested_by_user_id" uuid,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"acted_at" timestamp,
	"decision" varchar(40),
	"comment" text,
	"target_type" varchar(40),
	"target_id" uuid,
	"notification_presented_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_routes" ADD CONSTRAINT "project_approval_routes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_routes" ADD CONSTRAINT "project_approval_routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_steps" ADD CONSTRAINT "project_approval_steps_route_id_project_approval_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."project_approval_routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_step_users" ADD CONSTRAINT "project_approval_step_users_step_id_project_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."project_approval_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_approval_step_users" ADD CONSTRAINT "project_approval_step_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_uidx" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_company_idx" ON "project_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_approval_routes_project_type_uidx" ON "project_approval_routes" USING btree ("project_id","workflow_type");--> statement-breakpoint
CREATE INDEX "project_approval_routes_company_idx" ON "project_approval_routes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "project_approval_steps_route_idx" ON "project_approval_steps" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_assignee_status_idx" ON "workflow_tasks" USING btree ("assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_company_status_idx" ON "workflow_tasks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "workflow_tasks_project_idx" ON "workflow_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_tasks_entity_idx" ON "workflow_tasks" USING btree ("entity_type","entity_id","status");
