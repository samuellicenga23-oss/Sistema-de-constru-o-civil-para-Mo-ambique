CREATE TABLE IF NOT EXISTS "import_composition_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "match_key" varchar(220) NOT NULL,
  "source_code" varchar(30),
  "source_description" text,
  "composition_id" uuid NOT NULL REFERENCES "cost_compositions"("id") ON DELETE cascade,
  "hit_count" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_composition_mappings_company_key"
  ON "import_composition_mappings" ("company_id", "match_key");

CREATE INDEX IF NOT EXISTS "import_composition_mappings_company_idx"
  ON "import_composition_mappings" ("company_id");

CREATE TABLE IF NOT EXISTS "measurement_import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "budget_documents"("id") ON DELETE cascade,
  "file_name" varchar(300) NOT NULL,
  "file_path" text NOT NULL,
  "status" varchar(20) DEFAULT 'pendente' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "stage" varchar(200),
  "error_message" text,
  "preview" jsonb,
  "parsed_rows" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "measurement_import_jobs_doc_idx"
  ON "measurement_import_jobs" ("document_id", "updated_at");

CREATE INDEX IF NOT EXISTS "measurement_import_jobs_status_idx"
  ON "measurement_import_jobs" ("status", "updated_at");
