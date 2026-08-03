ALTER TABLE "budget_documents" ADD COLUMN "source_measurement_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "line_items" ADD COLUMN "source_measurement_item_id" uuid;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "template_key" varchar(180);--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "item_code" varchar(30);--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "composition_name" varchar(250);--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "discipline" varchar(40) DEFAULT 'outro' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "detection_tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "chapter_sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_source_measurement_item_id_line_items_id_fk" FOREIGN KEY ("source_measurement_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_templates" ADD CONSTRAINT "work_item_templates_template_key_unique" UNIQUE("template_key");