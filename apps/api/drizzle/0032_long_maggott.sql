ALTER TABLE "budget_documents" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD COLUMN "approval_note" text;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_certificates" ADD CONSTRAINT "measurement_certificates_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;