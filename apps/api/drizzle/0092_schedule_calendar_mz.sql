-- Calendário de obra MZ: feriados nacionais configuráveis e calendário por projecto.

CREATE TABLE IF NOT EXISTS "mz_holidays" (
	"year" integer NOT NULL,
	"date" date NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mz_holidays_pk" PRIMARY KEY("year", "date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mz_holidays_date_idx" ON "mz_holidays" ("date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_schedule_calendars" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"saturday_working" boolean DEFAULT true NOT NULL,
	"hours_per_day" numeric(4, 1),
	"use_national_holidays" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_schedule_calendars" ADD CONSTRAINT "project_schedule_calendars_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
INSERT INTO "mz_holidays" ("year", "date", "name") VALUES
  (2026, '2026-01-01', 'Ano Novo'),
  (2026, '2026-02-03', 'Dia dos Heróis Moçambicanos'),
  (2026, '2026-04-03', 'Sexta-feira Santa'),
  (2026, '2026-04-07', 'Dia da Mulher Moçambicana'),
  (2026, '2026-05-01', 'Dia do Trabalhador'),
  (2026, '2026-06-25', 'Dia da Independência'),
  (2026, '2026-09-07', 'Dia da Vitória'),
  (2026, '2026-09-25', 'Dia das Forças Armadas'),
  (2026, '2026-10-04', 'Dia da Paz e Reconciliação'),
  (2026, '2026-12-25', 'Natal')
ON CONFLICT ("year", "date") DO NOTHING;
