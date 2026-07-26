CREATE TABLE IF NOT EXISTS "measurement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"description" varchar(300) DEFAULT '' NOT NULL,
	"count" numeric(10, 2) DEFAULT '1' NOT NULL,
	"length" numeric(12, 3),
	"width" numeric(12, 3),
	"height" numeric(12, 3),
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_lines" ADD CONSTRAINT "measurement_lines_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
