ALTER TABLE "budget_documents" ADD COLUMN "document_type" varchar(20) DEFAULT 'orcamento' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD COLUMN "source_measurement_document_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_type" varchar(20) DEFAULT 'orcamento' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_documents" ADD CONSTRAINT "budget_documents_source_measurement_document_id_budget_documents_id_fk" FOREIGN KEY ("source_measurement_document_id") REFERENCES "public"."budget_documents"("id") ON DELETE set null ON UPDATE no action;