CREATE TYPE "public"."practice_client_type" AS ENUM('particular', 'empresa', 'ong', 'publico', 'outro');--> statement-breakpoint
CREATE TYPE "public"."practice_tender_status" AS ENUM('rascunho', 'em_preparacao', 'submetido', 'adjudicado', 'perdido', 'cancelado');--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "legal_name" varchar(240);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "trade_name" varchar(200);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "client_type" "practice_client_type" DEFAULT 'empresa' NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "nuit_foreign" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "province" varchar(100);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "district" varchar(100);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "payment_terms" varchar(200);--> statement-breakpoint
ALTER TABLE "practice_clients" ADD COLUMN "preferred_currency" "currency" DEFAULT 'MZN' NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "fx_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "payment_method_codes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "pipeline_source" varchar(80);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "probability_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "next_action" varchar(200);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "next_action_date" date;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_reference" varchar(120);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_deadline" date;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_status" "practice_tender_status";--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_bid_bond" jsonb;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_docs_checklist" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "tender_submission_evidence" text;
