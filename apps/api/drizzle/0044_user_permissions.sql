ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "role_permissions" jsonb;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "permissions" jsonb DEFAULT '[]'::jsonb NOT NULL;
