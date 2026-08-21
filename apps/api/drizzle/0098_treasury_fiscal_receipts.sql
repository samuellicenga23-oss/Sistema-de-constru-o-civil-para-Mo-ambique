-- Tesouraria, IVA via perfil fiscal e meios de pagamento em recibos (prompt 11). Não destrutivo.

ALTER TABLE "invoice_receipts" ADD COLUMN IF NOT EXISTS "payment_method_code" varchar(40);
--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD COLUMN IF NOT EXISTS "provider_ref" varchar(150);
--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD COLUMN IF NOT EXISTS "masked_account" varchar(80);
--> statement-breakpoint
ALTER TABLE "project_invoices" ADD COLUMN IF NOT EXISTS "iva_rate_source" varchar(240);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "treasury_cashflow_forecast_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "forecast_date" date NOT NULL,
  "kind" "financial_entry_type" NOT NULL,
  "source_type" varchar(40) NOT NULL,
  "source_id" uuid,
  "label" varchar(200) NOT NULL,
  "due_date" date,
  "amount" numeric(14, 2) NOT NULL,
  "currency" "currency" DEFAULT 'MZN' NOT NULL,
  "confidence" varchar(20) DEFAULT 'media' NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "treasury_forecast_project_date_idx"
  ON "treasury_cashflow_forecast_lines" ("project_id", "forecast_date");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_payment_method_fk"
    FOREIGN KEY ("payment_method_code") REFERENCES "payment_method_catalog"("code") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "treasury_cashflow_forecast_lines" ADD CONSTRAINT "treasury_forecast_project_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
