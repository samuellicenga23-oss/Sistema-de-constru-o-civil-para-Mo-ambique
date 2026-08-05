ALTER TABLE "subscriptions" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_cycle" varchar(20);--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" "currency" DEFAULT 'MZN' NOT NULL,
	"paid_at" timestamp DEFAULT now() NOT NULL,
	"period_start" date,
	"period_end" date,
	"plan" varchar(50) NOT NULL,
	"billing_cycle" varchar(20),
	"method" varchar(40) DEFAULT 'transferencia' NOT NULL,
	"reference" varchar(120),
	"notes" text,
	"recorded_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_payments_company_id_idx" ON "platform_payments" USING btree ("company_id");
