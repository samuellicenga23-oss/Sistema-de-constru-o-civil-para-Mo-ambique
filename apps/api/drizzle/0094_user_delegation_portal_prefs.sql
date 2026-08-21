ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "absent_from" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "absent_to" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "delegate_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "delegate_task_types" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb DEFAULT '{"digestEmail":false}'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
