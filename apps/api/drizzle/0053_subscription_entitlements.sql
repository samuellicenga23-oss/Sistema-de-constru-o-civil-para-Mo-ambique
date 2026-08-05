ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "kind" varchar(40) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "usage_events_company_kind_created_idx"
  ON "usage_events" ("company_id", "kind", "created_at");
