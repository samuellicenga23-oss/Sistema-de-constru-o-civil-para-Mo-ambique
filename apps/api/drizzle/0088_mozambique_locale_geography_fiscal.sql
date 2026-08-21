-- Fundação Moçambique: geografia administrativa, perfis fiscais effective-dated,
-- ligação zona de preço ↔ distritos, meios de pagamento. Não destrutivo.

CREATE TABLE IF NOT EXISTS "mz_provinces" (
	"code" varchar(8) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mz_districts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province_code" varchar(8) NOT NULL,
	"code" varchar(16) NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mz_districts_province_code_uq" ON "mz_districts" ("province_code", "code");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fiscal_rate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"kind" varchar(40) NOT NULL,
	"rate" numeric(8, 6) NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"source" varchar(240),
	"reference" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_rate_profiles_kind_dates_idx" ON "fiscal_rate_profiles" ("kind", "effective_from", "effective_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fiscal_rate_profiles_company_idx" ON "fiscal_rate_profiles" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_zone_districts" (
	"zone_id" uuid NOT NULL,
	"district_id" uuid NOT NULL,
	CONSTRAINT "price_zone_districts_pk" PRIMARY KEY("zone_id", "district_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_method_catalog" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"label" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "nuit_foreign" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "mz_districts" ADD CONSTRAINT "mz_districts_province_code_fk" FOREIGN KEY ("province_code") REFERENCES "mz_provinces"("code") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fiscal_rate_profiles" ADD CONSTRAINT "fiscal_rate_profiles_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "fiscal_rate_profiles" ADD CONSTRAINT "fiscal_rate_profiles_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_zone_districts" ADD CONSTRAINT "price_zone_districts_zone_fk" FOREIGN KEY ("zone_id") REFERENCES "price_zones"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "price_zone_districts" ADD CONSTRAINT "price_zone_districts_district_fk" FOREIGN KEY ("district_id") REFERENCES "mz_districts"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
INSERT INTO "mz_provinces" ("code", "name") VALUES
  ('CD', 'Cabo Delgado'),
  ('GZ', 'Gaza'),
  ('IN', 'Inhambane'),
  ('MN', 'Manica'),
  ('MP', 'Maputo'),
  ('MC', 'Maputo Cidade'),
  ('NM', 'Nampula'),
  ('NS', 'Niassa'),
  ('SF', 'Sofala'),
  ('TT', 'Tete'),
  ('ZB', 'Zambézia')
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "mz_districts" ("province_code", "code", "name")
SELECT v.province_code, v.code, v.name
FROM (VALUES
  ('MC', 'KAMPFUMO', 'KaMpfumo'),
  ('MC', 'KAMAXAKENI', 'KaMaxakeni'),
  ('MC', 'KAMAVOTA', 'KaMavota'),
  ('MC', 'KATEMBE', 'KaTembe'),
  ('MC', 'KANYAKA', 'KaNyaka'),
  ('MP', 'MATOLA', 'Matola'),
  ('MP', 'BOANE', 'Boane'),
  ('MP', 'MARRACUENE', 'Marracuene'),
  ('MP', 'MANHICA', 'Manhiça'),
  ('MP', 'NAMAACHA', 'Namaacha'),
  ('MP', 'MAGUDE', 'Magude'),
  ('MP', 'MOAMBA', 'Moamba'),
  ('MP', 'MATUTUINE', 'Matutuíne'),
  ('SF', 'BEIRA', 'Beira'),
  ('SF', 'DONDO', 'Dondo'),
  ('TT', 'TETE', 'Tete'),
  ('TT', 'MOATIZE', 'Moatize'),
  ('NM', 'NAMPULA', 'Nampula'),
  ('NM', 'NACALA', 'Nacala'),
  ('GZ', 'XAI-XAI', 'Xai-Xai'),
  ('IN', 'INHAMBANE', 'Inhambane'),
  ('MN', 'CHIMOIO', 'Chimoio'),
  ('ZB', 'QUELIMANE', 'Quelimane'),
  ('CD', 'PEMBA', 'Pemba'),
  ('NS', 'LICHINGA', 'Lichinga')
) AS v(province_code, code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM "mz_districts" d WHERE d.province_code = v.province_code AND d.code = v.code
);
--> statement-breakpoint
INSERT INTO "fiscal_rate_profiles" ("company_id", "kind", "rate", "effective_from", "effective_to", "source", "reference")
SELECT NULL, 'iva', 0.160000, '2023-01-01', NULL, 'Referência configurável SIGO', 'IVA padrão MZ — seed; alterar via perfil fiscal'
WHERE NOT EXISTS (
  SELECT 1 FROM "fiscal_rate_profiles" WHERE company_id IS NULL AND kind = 'iva' AND effective_from = '2023-01-01'
);
--> statement-breakpoint
INSERT INTO "fiscal_rate_profiles" ("company_id", "kind", "rate", "effective_from", "effective_to", "source", "reference")
SELECT NULL, 'inss_employer', 0.040000, '2023-01-01', NULL, 'Referência configurável SIGO', 'INSS TCO entidade empregadora — seed'
WHERE NOT EXISTS (
  SELECT 1 FROM "fiscal_rate_profiles" WHERE company_id IS NULL AND kind = 'inss_employer' AND effective_from = '2023-01-01'
);
--> statement-breakpoint
INSERT INTO "fiscal_rate_profiles" ("company_id", "kind", "rate", "effective_from", "effective_to", "source", "reference")
SELECT NULL, 'inss_worker', 0.030000, '2023-01-01', NULL, 'Referência configurável SIGO', 'INSS TCO trabalhador — seed'
WHERE NOT EXISTS (
  SELECT 1 FROM "fiscal_rate_profiles" WHERE company_id IS NULL AND kind = 'inss_worker' AND effective_from = '2023-01-01'
);
--> statement-breakpoint
INSERT INTO "payment_method_catalog" ("code", "label", "sort_order") VALUES
  ('transferencia', 'Transferência bancária', 10),
  ('mpesa', 'M-Pesa', 20),
  ('emola', 'e-Mola', 30),
  ('numerario', 'Numerário', 40),
  ('cheque', 'Cheque', 50),
  ('cartao', 'Cartão', 60),
  ('outro', 'Outro', 90)
ON CONFLICT ("code") DO NOTHING;
