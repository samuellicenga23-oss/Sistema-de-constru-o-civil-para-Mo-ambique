ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trashed_at" timestamp;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trash_reason" varchar(120);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "trashed_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "files_purged_at" timestamp;

CREATE INDEX IF NOT EXISTS "projects_trashed_at_idx" ON "projects" ("trashed_at");
CREATE INDEX IF NOT EXISTS "projects_company_trashed_idx" ON "projects" ("company_id", "trashed_at");
