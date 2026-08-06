CREATE TYPE "public"."payment_proof_status" AS ENUM('pendente', 'aprovado', 'rejeitado');--> statement-breakpoint
CREATE TABLE "payment_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"plan" varchar(50) NOT NULL,
	"billing_cycle" varchar(20),
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"method" varchar(40) NOT NULL,
	"reference" varchar(120),
	"notes" text,
	"file_path" text NOT NULL,
	"original_file_name" varchar(300),
	"status" "payment_proof_status" DEFAULT 'pendente' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_proofs_company_id_idx" ON "payment_proofs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs" USING btree ("status","created_at");
