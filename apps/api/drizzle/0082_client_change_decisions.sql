ALTER TABLE "contract_variations" ADD COLUMN "impact_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN "client_decision" varchar(20);--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN "client_decided_at" timestamp;--> statement-breakpoint
ALTER TABLE "contract_variations" ADD COLUMN "client_decision_note" text;
