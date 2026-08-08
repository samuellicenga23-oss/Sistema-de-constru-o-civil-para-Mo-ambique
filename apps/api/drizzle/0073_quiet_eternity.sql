CREATE TYPE "public"."procurement_goods_return_status" AS ENUM('rascunho', 'expedida', 'recebida_fornecedor', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."procurement_nonconformity_resolution" AS ENUM('substituicao', 'nota_credito', 'devolucao', 'aceite_com_desconto', 'outro');--> statement-breakpoint
CREATE TYPE "public"."procurement_nonconformity_status" AS ENUM('aberta', 'aguarda_fornecedor', 'solucao_proposta', 'aguarda_substituicao', 'aguarda_credito', 'devolucao_pendente', 'resolvida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_credit_note_status" AS ENUM('submetida', 'aceite', 'rejeitada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."supplier_invoice_status" AS ENUM('rascunho', 'submetida', 'em_revisao', 'divergente', 'aprovada', 'rejeitada', 'parcialmente_paga', 'paga', 'cancelada');--> statement-breakpoint
CREATE TABLE "procurement_goods_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nonconformity_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"goods_receipt_line_id" uuid NOT NULL,
	"reference" varchar(50) NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"status" "procurement_goods_return_status" DEFAULT 'rascunho' NOT NULL,
	"return_date" date,
	"reason" text,
	"tracking_reference" varchar(160),
	"created_by_user_id" uuid,
	"confirmed_by_supplier_account_id" uuid,
	"supplier_confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_goods_return_reference_unique" UNIQUE("company_id","reference")
);
--> statement-breakpoint
CREATE TABLE "procurement_nonconformities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"goods_receipt_line_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"reference" varchar(50) NOT NULL,
	"rejected_qty" numeric(14, 3) NOT NULL,
	"status" "procurement_nonconformity_status" DEFAULT 'aguarda_fornecedor' NOT NULL,
	"description" text NOT NULL,
	"resolution_type" "procurement_nonconformity_resolution",
	"proposed_replacement_qty" numeric(14, 3),
	"proposed_credit_amount" numeric(14, 2),
	"supplier_response" text,
	"buyer_resolution_notes" text,
	"created_by_user_id" uuid,
	"responded_by_supplier_account_id" uuid,
	"responded_at" timestamp,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procurement_nonconformity_receipt_line_unique" UNIQUE("goods_receipt_line_id"),
	CONSTRAINT "procurement_nonconformity_reference_unique" UNIQUE("company_id","reference")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"nonconformity_id" uuid,
	"credit_number" varchar(120) NOT NULL,
	"issue_date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "supplier_invoice_credit_note_status" DEFAULT 'submetida' NOT NULL,
	"submitted_by_supplier_account_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoice_credit_number_unique" UNIQUE("supplier_invoice_id","credit_number")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"description" varchar(300) NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_cost" numeric(14, 4) NOT NULL,
	"line_total" numeric(14, 2) NOT NULL,
	CONSTRAINT "supplier_invoice_order_line_unique" UNIQUE("supplier_invoice_id","purchase_order_line_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"method" varchar(50) DEFAULT 'transferencia' NOT NULL,
	"reference" varchar(160),
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"invoice_number" varchar(120) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"status" "supplier_invoice_status" DEFAULT 'rascunho' NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"iva_rate" numeric(5, 4) NOT NULL,
	"transport_cost" numeric(14, 2) DEFAULT '0' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vat_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"supplier_notes" text,
	"buyer_notes" text,
	"match_status" varchar(30) DEFAULT 'pendente' NOT NULL,
	"match_snapshot" jsonb,
	"matched_at" timestamp,
	"variance_reason" text,
	"variance_approved_by_user_id" uuid,
	"variance_approved_at" timestamp,
	"submitted_by_supplier_account_id" uuid,
	"created_by_user_id" uuid,
	"submitted_at" timestamp,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp,
	"approved_by_user_id" uuid,
	"approved_at" timestamp,
	"rejected_by_user_id" uuid,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoice_supplier_number_unique" UNIQUE("supplier_id","invoice_number")
);
--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_nonconformity_id_procurement_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."procurement_nonconformities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_goods_returns" ADD CONSTRAINT "procurement_goods_returns_confirmed_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("confirmed_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_goods_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_responded_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("responded_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurement_nonconformities" ADD CONSTRAINT "procurement_nonconformities_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_credit_notes" ADD CONSTRAINT "supplier_invoice_credit_notes_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_credit_notes" ADD CONSTRAINT "supplier_invoice_credit_notes_nonconformity_id_procurement_nonconformities_id_fk" FOREIGN KEY ("nonconformity_id") REFERENCES "public"."procurement_nonconformities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_credit_notes" ADD CONSTRAINT "supplier_invoice_credit_notes_submitted_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("submitted_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_credit_notes" ADD CONSTRAINT "supplier_invoice_credit_notes_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchase_order_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_payments" ADD CONSTRAINT "supplier_invoice_payments_supplier_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("supplier_invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoice_payments" ADD CONSTRAINT "supplier_invoice_payments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_variance_approved_by_user_id_users_id_fk" FOREIGN KEY ("variance_approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_submitted_by_supplier_account_id_supplier_accounts_id_fk" FOREIGN KEY ("submitted_by_supplier_account_id") REFERENCES "public"."supplier_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procurement_goods_return_ncr_status_idx" ON "procurement_goods_returns" USING btree ("nonconformity_id","status");--> statement-breakpoint
CREATE INDEX "procurement_nonconformity_project_status_idx" ON "procurement_nonconformities" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "procurement_nonconformity_supplier_order_idx" ON "procurement_nonconformities" USING btree ("purchase_order_id","status");--> statement-breakpoint
CREATE INDEX "supplier_invoice_credit_invoice_status_idx" ON "supplier_invoice_credit_notes" USING btree ("supplier_invoice_id","status");--> statement-breakpoint
CREATE INDEX "supplier_invoice_payment_invoice_date_idx" ON "supplier_invoice_payments" USING btree ("supplier_invoice_id","payment_date");--> statement-breakpoint
CREATE INDEX "supplier_invoice_project_status_idx" ON "supplier_invoices" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "supplier_invoice_order_status_idx" ON "supplier_invoices" USING btree ("purchase_order_id","status");