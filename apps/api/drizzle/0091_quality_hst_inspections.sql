-- Inspecções de qualidade/HST e observações de campo (prompt 09). Não destrutivo.

DO $$ BEGIN
  CREATE TYPE "public"."inspection_checklist_trade" AS ENUM(
    'cofragem', 'armadura', 'betão', 'alvenaria', 'impermeabilizacao', 'instalacoes', 'acabamentos'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."quality_inspection_status" AS ENUM('rascunho', 'pass', 'fail', 'pendente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."hst_record_type" AS ENUM('toolbox_talk', 'incidente', 'observacao_risco', 'ppe_check');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspection_checklist_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "trade" "inspection_checklist_trade" NOT NULL,
  "name" varchar(200) NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inspection_checklist_template_company_trade"
  ON "inspection_checklist_templates" ("company_id", "trade");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quality_inspections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "template_id" uuid,
  "trade" "inspection_checklist_trade" NOT NULL,
  "location" varchar(200),
  "schedule_task_id" uuid,
  "inspector_user_id" uuid,
  "inspection_date" date NOT NULL,
  "status" "quality_inspection_status" DEFAULT 'rascunho' NOT NULL,
  "checklist_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "photo_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "diary_entry_id" uuid,
  "offline_sync_key" varchar(100),
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quality_inspections_project_date_idx"
  ON "quality_inspections" ("project_id", "inspection_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "quality_inspections_offline_sync"
  ON "quality_inspections" ("project_id", "offline_sync_key")
  WHERE "offline_sync_key" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hst_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "record_type" "hst_record_type" NOT NULL,
  "record_date" date NOT NULL,
  "location" varchar(200),
  "description" text NOT NULL,
  "photo_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "diary_entry_id" uuid,
  "offline_sync_key" varchar(100),
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hst_records_project_date_idx"
  ON "hst_records" ("project_id", "record_date");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hst_records_offline_sync"
  ON "hst_records" ("project_id", "offline_sync_key")
  WHERE "offline_sync_key" IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inspection_checklist_templates" ADD CONSTRAINT "inspection_checklist_templates_company_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_company_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_template_fk"
    FOREIGN KEY ("template_id") REFERENCES "inspection_checklist_templates"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_task_fk"
    FOREIGN KEY ("schedule_task_id") REFERENCES "schedule_tasks"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_inspector_fk"
    FOREIGN KEY ("inspector_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_diary_fk"
    FOREIGN KEY ("diary_entry_id") REFERENCES "site_diary_entries"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hst_records" ADD CONSTRAINT "hst_records_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hst_records" ADD CONSTRAINT "hst_records_company_fk"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hst_records" ADD CONSTRAINT "hst_records_diary_fk"
    FOREIGN KEY ("diary_entry_id") REFERENCES "site_diary_entries"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "hst_records" ADD CONSTRAINT "hst_records_created_by_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
