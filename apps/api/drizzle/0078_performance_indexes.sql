CREATE INDEX IF NOT EXISTS "projects_company_created_idx" ON "projects" USING btree ("company_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_documents_project_created_idx" ON "budget_documents" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "budget_sections_document_sort_idx" ON "budget_sections" USING btree ("document_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_section_sort_idx" ON "line_items" USING btree ("section_id","sort_order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_parent_idx" ON "line_items" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_certificates_project_created_idx" ON "measurement_certificates" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plants_project_uploaded_idx" ON "plants" USING btree ("project_id","uploaded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plants_status_updated_idx" ON "plants" USING btree ("processing_status","processing_updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "financial_entries_project_status_idx" ON "financial_entries" USING btree ("project_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_diary_entries_project_date_idx" ON "site_diary_entries" USING btree ("project_id","date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_orders_project_status_idx" ON "purchase_orders" USING btree ("project_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_supplier_created_idx" ON "notifications" USING btree ("supplier_account_id","created_at");
