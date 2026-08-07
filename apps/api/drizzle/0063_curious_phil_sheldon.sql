CREATE TYPE "public"."supplier_price_feed_sync_status" AS ENUM('sucesso', 'erro');--> statement-breakpoint
CREATE TABLE "supplier_price_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"feed_url" text NOT NULL,
	"api_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"last_sync_at" timestamp,
	"last_sync_status" "supplier_price_feed_sync_status",
	"last_sync_error" text,
	"last_sync_matched" integer,
	"last_sync_unmatched" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_price_feeds_supplier_id_unique" UNIQUE("supplier_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_price_feeds" ADD CONSTRAINT "supplier_price_feeds_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;