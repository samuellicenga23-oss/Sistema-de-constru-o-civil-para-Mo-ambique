ALTER TABLE "extracted_openings" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "extracted_openings" ADD COLUMN "technical_specification" text;--> statement-breakpoint
ALTER TABLE "extracted_openings" ADD CONSTRAINT "extracted_openings_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE set null ON UPDATE no action;