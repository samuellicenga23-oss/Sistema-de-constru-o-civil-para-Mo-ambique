-- Retenções contratuais no Auto e campos de variação (prompt 10). Não destrutivo.

ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "contract_variation_id" uuid;
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "gross_certified_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "retention_rate_snapshot" numeric(5, 4);
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "retention_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "previous_retention_held" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "net_due_amount" numeric(14, 2);
--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN IF NOT EXISTS "released_retention_amount" numeric(14, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN IF NOT EXISTS "scope" text;
--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN IF NOT EXISTS "linked_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN IF NOT EXISTS "evidence_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN IF NOT EXISTS "requested_by_user_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_variation_fk"
    FOREIGN KEY ("contract_variation_id") REFERENCES "contract_variations"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "contract_variations" ADD CONSTRAINT "contract_variations_requested_by_fk"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
