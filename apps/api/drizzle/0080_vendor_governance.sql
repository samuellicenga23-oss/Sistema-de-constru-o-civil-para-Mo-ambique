CREATE TYPE "public"."vendor_governance_status" AS ENUM('qualificado', 'preferencial', 'observacao', 'bloqueado');--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "governance_status" "vendor_governance_status" DEFAULT 'qualificado' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "blocked_at" timestamp;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "blocked_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_blocked_by_user_id_users_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "supplier_compliance_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"company_id" uuid,
	"kind" varchar(60) NOT NULL,
	"number" varchar(80),
	"expires_on" date,
	"file_ref" varchar(400),
	"status" varchar(20) DEFAULT 'valido' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_compliance_documents" ADD CONSTRAINT "supplier_compliance_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_compliance_documents" ADD CONSTRAINT "supplier_compliance_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_compliance_supplier_idx" ON "supplier_compliance_documents" USING btree ("supplier_id");
