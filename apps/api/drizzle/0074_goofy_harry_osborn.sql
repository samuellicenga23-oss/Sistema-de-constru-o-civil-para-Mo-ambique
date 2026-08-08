CREATE TYPE "public"."procurement_bank_transaction_status" AS ENUM('importado', 'sugerido', 'reconciliado', 'ignorado');--> statement-breakpoint
CREATE TYPE "public"."procurement_payment_request_status" AS ENUM('rascunho', 'submetido', 'aprovado', 'rejeitado', 'executado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_fiscal_document_status" AS ENUM('carregado', 'extraido', 'requer_revisao', 'validado', 'rejeitado');--> statement-breakpoint
CREATE TABLE "procurement_bank_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"payment_request_id" uuid NOT NULL,
	"match_method" varchar(30) DEFAULT 'manual' NOT NULL,
	"match_score" integer,
	"notes" text,
	"reconciled_by_user_id" uuid,
	"reconciled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_bank_reconciliation_transaction_unique" UNIQUE("bank_transaction_id"),
	CONSTRAINT "procurement_bank_reconciliation_payment_unique" UNIQUE("payment_request_id")
);
--> statement-breakpoint
CREATE TABLE "procurement_bank_statement_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"bank_name" varchar(160) NOT NULL,
	"account_label" varchar(160),
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"original_name" varchar(300) NOT NULL,
	"file_path" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_bank_statement_hash_unique" UNIQUE("company_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "procurement_bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"statement_import_id" uuid NOT NULL,
	"status" "procurement_bank_transaction_status" DEFAULT 'importado' NOT NULL,
	"transaction_date" date NOT NULL,
	"value_date" date,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"description" text,
	"reference" varchar(240),
	"counterparty" varchar(240),
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_bank_transaction_fingerprint_unique" UNIQUE("company_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "procurement_payment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"reference" varchar(50) NOT NULL,
	"status" "procurement_payment_request_status" DEFAULT 'rascunho' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"requested_payment_date" date,
	"method" varchar(50) DEFAULT 'transferencia' NOT NULL,
	"payee_bank_name" varchar(160),
	"payee_account_name" varchar(200),
	"payee_account_number" varchar(120),
	"reason" text,
	"notes" text,
	"requested_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp,
	"approved_by_user_id" uuid,
	"approved_at" timestamp,
	"approval_override_reason" text,
	"rejected_by_user_id" uuid,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"executed_by_user_id" uuid,
	"executed_at" timestamp,
	"execution_date" date,
	"execution_reference" varchar(160),
	"execution_override_reason" text,
	"supplier_invoice_payment_id" uuid,
	"execution_proof_file_path" text,
	"execution_proof_original_name" varchar(300),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_payment_request_reference_unique" UNIQUE("company_id","reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_fiscal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "supplier_invoice_fiscal_document_status" DEFAULT 'carregado' NOT NULL,
	"file_path" text NOT NULL,
	"original_name" varchar(300) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"extraction_provider" varchar(120),
	"extraction_confidence" numeric(6, 5),
	"extracted_data" jsonb,
	"reviewed_data" jsonb,
	"extraction_message" text,
	"extracted_at" timestamp,
	"validation_snapshot" jsonb,
	"validated_by_user_id" uuid,
	"validated_at" timestamp,
	"rejection_reason" text,
	"uploaded_by_supplier_account_id" uuid,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoice_fiscal_document_version_unique" UNIQUE("supplier_invoice_id","version"),
	CONSTRAINT "supplier_invoice_fiscal_document_hash_unique" UNIQUE("company_id","sha256")
);
--> statement-breakpoint
ALTER TABLE "procurement_bank_reconciliations" ADD CONSTRAINT "procurement_bank_reconciliations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_reconciliations" ADD CONSTRAINT "procurement_bank_reconciliations_bank_transaction_id_procurement_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."procurement_bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_reconciliations" ADD CONSTRAINT "procurement_bank_reconciliations_payment_request_id_procurement_payment_requests_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."procurement_payment_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_reconciliations" ADD CONSTRAINT "procurement_bank_reconciliations_reconciled_by_user_id_users_id_fk" FOREIGN KEY ("reconciled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_statement_imports" ADD CONSTRAINT "procurement_bank_statement_imports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_statement_imports" ADD CONSTRAINT "procurement_bank_statement_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_statement_imports" ADD CONSTRAINT "procurement_bank_statement_imports_imported_by_user_id_users_id_fk" FOREIGN KEY ("imported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_transactions" ADD CONSTRAINT "procurement_bank_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_transactions" ADD CONSTRAINT "procurement_bank_transactions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_bank_transactions" ADD CONSTRAINT "procurement_bank_transactions_statement_import_id_procurement_bank_statement_imports_id_fk" FOREIGN KEY ("statement_import_id") REFERENCES "public"."procurement_bank_statement_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_payment_requests" ADD CONSTRAINT "procurement_payment_requests_supplier_invoice_payment_id_supplier_invoice_payments_id_fk" FOREIGN KEY ("supplier_invoice_payment_id") REFERENCES "public"."supplier_invoice_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_fiscal_documents" ADD CONSTRAINT "supplier_invoice_fiscal_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_fiscal_documents" ADD CONSTRAINT "supplier_invoice_fiscal_documents_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_fiscal_documents" ADD CONSTRAINT "supplier_invoice_fiscal_documents_validated_by_user_id_users_id_fk" FOREIGN KEY ("validated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_fiscal_documents" ADD CONSTRAINT "supplier_invoice_fiscal_documents_uploaded_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("uploaded_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_fiscal_documents" ADD CONSTRAINT "supplier_invoice_fiscal_documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_bank_statement_project_idx" ON "procurement_bank_statement_imports" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "procurement_bank_transaction_project_status_idx" ON "procurement_bank_transactions" USING btree ("project_id","status","transaction_date");--> statement-breakpoint
CREATE INDEX "procurement_payment_request_invoice_status_idx" ON "procurement_payment_requests" USING btree ("supplier_invoice_id","status");--> statement-breakpoint
CREATE INDEX "procurement_payment_request_project_idx" ON "procurement_payment_requests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "supplier_invoice_fiscal_document_invoice_idx" ON "supplier_invoice_fiscal_documents" USING btree ("supplier_invoice_id","created_at");