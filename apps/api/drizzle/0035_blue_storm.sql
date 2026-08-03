CREATE TYPE "public"."credit_note_status" AS ENUM('rascunho', 'emitida', 'cancelada');--> statement-breakpoint
CREATE TABLE "invoice_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"credit_number" varchar(80) NOT NULL,
	"issue_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "credit_note_status" DEFAULT 'rascunho' NOT NULL,
	"created_by_user_id" uuid,
	"issued_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_credit_note_number_unique" UNIQUE("invoice_id","credit_number")
);
--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD COLUMN "proof_file_path" text;--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD COLUMN "proof_original_name" varchar(300);--> statement-breakpoint
ALTER TABLE "invoice_credit_notes" ADD CONSTRAINT "invoice_credit_notes_invoice_id_project_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."project_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_credit_notes" ADD CONSTRAINT "invoice_credit_notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_credit_notes" ADD CONSTRAINT "invoice_credit_notes_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;