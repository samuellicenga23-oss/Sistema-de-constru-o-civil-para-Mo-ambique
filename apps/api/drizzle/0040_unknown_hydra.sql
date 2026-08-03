CREATE TABLE "extracted_openings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plant_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"code" varchar(40),
	"width_m" numeric(8, 3),
	"height_m" numeric(8, 3),
	"sill_height_m" numeric(8, 3),
	"quantity" integer DEFAULT 1 NOT NULL,
	"floor" varchar(100),
	"location" varchar(20) DEFAULT 'desconhecida' NOT NULL,
	"material" varchar(120),
	"page" integer NOT NULL,
	"confidence" numeric(4, 3) DEFAULT '0' NOT NULL,
	"source" varchar(20) NOT NULL,
	"needs_confirmation" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extracted_rooms" ADD COLUMN "perimeter_m" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "extracted_openings" ADD CONSTRAINT "extracted_openings_plant_id_plants_id_fk" FOREIGN KEY ("plant_id") REFERENCES "public"."plants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extracted_openings_plant_idx" ON "extracted_openings" USING btree ("plant_id");