-- Equipas, subempreiteiros e INSS configurável (prompt 12). Não destrutivo.

DO $$ BEGIN
  CREATE TYPE "public"."workforce_worker_kind" AS ENUM('employee', 'casual', 'subcontract_worker');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."workforce_timesheet_status" AS ENUM('rascunho', 'submetido', 'aprovado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_workers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid,
  "kind" "workforce_worker_kind" DEFAULT 'employee' NOT NULL,
  "name" varchar(200) NOT NULL,
  "trade" varchar(100),
  "reference" varchar(80),
  "contact" varchar(120),
  "hourly_cost" numeric(14, 4),
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_crews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "foreman_user_id" uuid,
  "trade" varchar(100),
  "default_productivity_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_crew_members" (
  "crew_id" uuid NOT NULL,
  "worker_id" uuid NOT NULL,
  CONSTRAINT "workforce_crew_members_pk" PRIMARY KEY("crew_id", "worker_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workforce_timesheets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "worker_id" uuid,
  "crew_id" uuid,
  "work_date" date NOT NULL,
  "hours" numeric(6, 2) DEFAULT '8' NOT NULL,
  "overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
  "schedule_task_id" uuid,
  "diary_entry_id" uuid,
  "status" "workforce_timesheet_status" DEFAULT 'rascunho' NOT NULL,
  "notes" text,
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_subcontractors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "nuit" varchar(50),
  "contract_ref" varchar(120),
  "scope" text,
  "contract_value" numeric(14, 2),
  "retention_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
  "progress_notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workforce_workers_company_project_idx" ON "workforce_workers" ("company_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workforce_crews_project_idx" ON "workforce_crews" ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workforce_timesheets_project_date_idx" ON "workforce_timesheets" ("project_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_subcontractors_project_idx" ON "project_subcontractors" ("project_id");
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_workers" ADD CONSTRAINT "workforce_workers_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_workers" ADD CONSTRAINT "workforce_workers_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_crews" ADD CONSTRAINT "workforce_crews_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_crew_fk" FOREIGN KEY ("crew_id") REFERENCES "workforce_crews"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_crew_members" ADD CONSTRAINT "workforce_crew_members_worker_fk" FOREIGN KEY ("worker_id") REFERENCES "workforce_workers"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "workforce_timesheets" ADD CONSTRAINT "workforce_timesheets_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_subcontractors" ADD CONSTRAINT "project_subcontractors_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "project_subcontractors" ADD CONSTRAINT "project_subcontractors_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
