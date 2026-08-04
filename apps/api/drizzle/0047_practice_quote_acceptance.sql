ALTER TABLE "practice_quotes" ADD COLUMN "accepted_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "discount_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "discount_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "practice_quotes" ADD COLUMN "acceptance_notes" text;
