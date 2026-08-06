CREATE TABLE IF NOT EXISTS "subscription_credit_balances" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE cascade,
  "smart_import_credits" integer NOT NULL DEFAULT 0,
  "plant_analysis_credits" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscription_credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "kind" varchar(40) NOT NULL,
  "delta" integer NOT NULL,
  "pack_id" varchar(40),
  "reason" varchar(80) NOT NULL,
  "note" text,
  "amount_mzn" numeric(14, 2),
  "recorded_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "subscription_credit_ledger_company_created_idx"
  ON "subscription_credit_ledger" ("company_id", "created_at");
