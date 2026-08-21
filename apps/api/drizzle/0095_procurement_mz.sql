-- Procurement MZ: NUIT, prazos regionais e termos de pagamento (30/60 dias).

CREATE TABLE IF NOT EXISTS "procurement_payment_terms_catalog" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(120) NOT NULL,
	"days_credit" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "legal_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "trade_name" varchar(200);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "nuit_foreign" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "province" varchar(100);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "district" varchar(100);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "bank_details" text;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "mobile_wallet_contact" varchar(80);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "preferred_currency" "currency" DEFAULT 'MZN';
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "default_lead_time_days" integer;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "lead_time_by_zone" jsonb;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "payment_method_code" varchar(40);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "vendor_registration_status" varchar(20) DEFAULT 'prospect' NOT NULL;
--> statement-breakpoint
ALTER TABLE "procurement_rfqs" ADD COLUMN IF NOT EXISTS "regional_note" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "regional_note" text;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "payment_terms_code" varchar(40);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_method_fk" FOREIGN KEY ("payment_method_code") REFERENCES "payment_method_catalog"("code") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_payment_terms_fk" FOREIGN KEY ("payment_terms_code") REFERENCES "procurement_payment_terms_catalog"("code") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
INSERT INTO "procurement_payment_terms_catalog" ("code", "label", "days_credit", "sort_order") VALUES
  ('30_dias', '30 dias', 30, 10),
  ('60_dias', '60 dias', 60, 20)
ON CONFLICT ("code") DO NOTHING;
