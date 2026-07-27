CREATE TYPE "public"."schedule_dependency_type" AS ENUM('FS', 'SS', 'FF', 'SF');--> statement-breakpoint
CREATE TYPE "public"."schedule_task_status" AS ENUM('nao_iniciado', 'em_curso', 'bloqueado', 'concluido');--> statement-breakpoint
CREATE TABLE "schedule_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"predecessor_task_id" uuid NOT NULL,
	"successor_task_id" uuid NOT NULL,
	"type" "schedule_dependency_type" DEFAULT 'FS' NOT NULL,
	"lag_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "schedule_dependency_unique" UNIQUE("predecessor_task_id","successor_task_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"budget_document_id" uuid,
	"parent_id" uuid,
	"code" varchar(30) NOT NULL,
	"name" varchar(240) NOT NULL,
	"budget_chapter_code" varchar(30),
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"baseline_start_date" date,
	"baseline_end_date" date,
	"actual_start_date" date,
	"actual_end_date" date,
	"duration_days" integer DEFAULT 1 NOT NULL,
	"manual_progress" numeric(5, 2),
	"status" "schedule_task_status" DEFAULT 'nao_iniciado' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_diary_task_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"diary_entry_id" uuid NOT NULL,
	"schedule_task_id" uuid NOT NULL,
	"progress_percent" numeric(5, 2) NOT NULL,
	"notes" text,
	CONSTRAINT "site_diary_task_progress_unique" UNIQUE("diary_entry_id","schedule_task_id")
);
--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "source_type" varchar(40);--> statement-breakpoint
ALTER TABLE "financial_entries" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "measurement_certificate_lines" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "measurement_certificate_lines" ADD COLUMN "overrun_reason" text;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "period_start_date" date;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "required_by_date" date;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "schedule_task_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "diary_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_predecessor_task_id_schedule_tasks_id_fk" FOREIGN KEY ("predecessor_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_dependencies" ADD CONSTRAINT "schedule_dependencies_successor_task_id_schedule_tasks_id_fk" FOREIGN KEY ("successor_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_budget_document_id_budget_documents_id_fk" FOREIGN KEY ("budget_document_id") REFERENCES "public"."budget_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_parent_id_schedule_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_diary_task_progress" ADD CONSTRAINT "site_diary_task_progress_diary_entry_id_site_diary_entries_id_fk" FOREIGN KEY ("diary_entry_id") REFERENCES "public"."site_diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_diary_task_progress" ADD CONSTRAINT "site_diary_task_progress_schedule_task_id_schedule_tasks_id_fk" FOREIGN KEY ("schedule_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_schedule_task_id_schedule_tasks_id_fk" FOREIGN KEY ("schedule_task_id") REFERENCES "public"."schedule_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_diary_entry_id_site_diary_entries_id_fk" FOREIGN KEY ("diary_entry_id") REFERENCES "public"."site_diary_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entry_source_unique" UNIQUE("project_id","source_type","source_id");