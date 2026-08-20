CREATE TABLE "company_vendor_governance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"governance_status" "vendor_governance_status" DEFAULT 'qualificado' NOT NULL,
	"blocked_reason" text,
	"blocked_at" timestamp,
	"blocked_by_user_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_vendor_governance" ADD CONSTRAINT "company_vendor_governance_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_vendor_governance" ADD CONSTRAINT "company_vendor_governance_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_vendor_governance" ADD CONSTRAINT "company_vendor_governance_blocked_by_user_id_users_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_vendor_governance" ADD CONSTRAINT "company_vendor_governance_unique" UNIQUE("company_id","supplier_id");--> statement-breakpoint
CREATE INDEX "company_vendor_governance_company_idx" ON "company_vendor_governance" USING btree ("company_id");
