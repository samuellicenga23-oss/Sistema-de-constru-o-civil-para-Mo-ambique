ALTER TABLE "schedule_tasks" ADD COLUMN IF NOT EXISTS "budget_line_item_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD COLUMN IF NOT EXISTS "duration_basis" varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_budget_line_item_id_line_items_id_fk" FOREIGN KEY ("budget_line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedule_tasks_budget_line_item_idx" ON "schedule_tasks" USING btree ("budget_line_item_id");
