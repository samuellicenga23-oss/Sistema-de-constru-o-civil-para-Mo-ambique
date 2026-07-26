ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "labour_categories" ADD CONSTRAINT "labour_categories_company_id_name_unique" UNIQUE("company_id","name");--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_company_id_name_unique" UNIQUE("company_id","name");