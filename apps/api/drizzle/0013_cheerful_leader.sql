CREATE TABLE "site_diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"weather" varchar(50),
	"workers_present" integer,
	"equipment_present" text,
	"work_done" text NOT NULL,
	"materials_received" text,
	"materials_consumed" text,
	"visitors" text,
	"inspector_instructions" text,
	"incidents" text,
	"decisions" text,
	"entry_time" varchar(5),
	"exit_time" varchar(5),
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_diary_entries" ADD CONSTRAINT "site_diary_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_diary_entries" ADD CONSTRAINT "site_diary_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;